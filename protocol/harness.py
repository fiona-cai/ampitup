"""Run Jev or local Laya against any validated v1.0 event snapshot."""

import argparse
import json
import subprocess
from collections import Counter
from pathlib import Path
from zoneinfo import ZoneInfoNotFoundError

from jsonschema.exceptions import ValidationError

from context import context_for
from validate import validate

ROOT = Path(__file__).resolve().parent.parent
LABELS = ("needs_budget", "no_budget", "needs_review")


def jev_decisions(requests):
    executable = ROOT / "node_modules/.bin/tsx"
    if not executable.is_file():
        raise ValueError("Jev requires Node dependencies; run npm ci first")
    result = subprocess.run(
        [str(executable), str(ROOT / "protocol/jev_bridge.ts")],
        input=json.dumps(requests), text=True, capture_output=True, check=True,
        cwd=ROOT, timeout=120,
    )
    return json.loads(result.stdout)


def laya_predictions(requests):
    executable = ROOT / "laya/.venv/bin/python"
    if not executable.is_file():
        raise ValueError("Laya requires its local environment; run laya/setup.sh first")
    result = subprocess.run(
        [str(executable), str(ROOT / "laya/budget_gate.py")],
        input=json.dumps(requests), text=True, capture_output=True, check=True,
        cwd=ROOT, timeout=600,
    )
    return json.loads(result.stdout)


def guard(event):
    """Structured connector facts override title heuristics or model output."""
    if event["status"] == "cancelled" or event["attendance"] == "declined":
        return "no_budget", ["Event cancelled or attendance declined"]
    if event["purpose"]["scope"] == "personal":
        return "no_budget", ["Personal event outside the work funding scope"]
    if (event["purpose"]["scope"] == "unknown" or event["status"] == "tentative"
            or event["attendance"] != "accepted"):
        return "needs_review", ["Work purpose or attendance is unconfirmed"]
    expenses = event["expenses"]
    if expenses is None:
        return None, []
    if any(line["coverage"] == "unknown" for line in expenses):
        return "needs_review", ["Expense coverage is unknown"]
    unpaid = [line for line in expenses if line["coverage"] == "not_covered"
              and line["estimatedAmountMinor"] != 0]
    if unpaid:
        return "needs_budget", ["Uncovered expense: " + ", ".join(sorted({line["category"] for line in unpaid}))]
    return "no_budget", ["No expected expense or every expense is already covered"]


def one_hot(label):
    return {name: float(name == label) for name in LABELS}


def run(snapshot, *, backend="jev", min_confidence=0.75, expected=None):
    validate(snapshot)
    if backend not in ("jev", "laya"):
        raise ValueError("backend must be jev or laya")
    if not 0 <= min_confidence <= 1:
        raise ValueError("min-confidence must be between zero and one")
    requests = [{"schemaVersion": "1.0", "requestId": f"{snapshot['snapshotId']}:{event['id']}",
                 "event": event, "context": context_for(event, snapshot), "policy": snapshot["policy"]}
                for event in snapshot["events"]]
    for request in requests:
        validate(request, "gateRequest")
    ids = {event["id"] for event in snapshot["events"]}
    expected = {} if expected is None else expected
    if not isinstance(expected, dict) or any(label not in LABELS for label in expected.values()):
        raise ValueError("expected labels must map event IDs to needs_budget, no_budget, or needs_review")
    if set(expected) - ids:
        raise ValueError("expected labels contain event IDs absent from the snapshot")

    baseline = jev_decisions(requests) if requests else []
    # Laya only handles unresolved facts; deterministic guards are sufficient
    # for confirmed coverage, personal events, and cancelled attendance.
    unresolved = [i for i, request in enumerate(requests) if guard(request["event"])[0] is None]
    predictions = {}
    if backend == "laya" and unresolved:
        predictions = dict(zip(unresolved, laya_predictions([requests[i] for i in unresolved]), strict=True))

    rows = []
    for i, request in enumerate(requests):
        event, decision = request["event"], baseline[i]
        guarded, signals = guard(event)
        reasons = []
        model_id = None
        token_info = None
        if guarded is not None:
            probabilities = one_hot(guarded)
            gate_backend = "policy_guard"
            if guarded == "needs_review":
                reasons.extend(signals)
        elif backend == "laya":
            prediction = predictions[i]
            probabilities = prediction["probabilities"]
            gate_backend = "laya"
            model_id = prediction["modelId"]
            token_info = {"inputTokens": prediction["inputTokens"], "truncated": prediction["truncated"]}
            signals = ["Local classifier used event, schedule context, and policy facts"]
            if prediction["truncated"]:
                reasons.append("Classifier input exceeded its token budget")
        else:
            raw = ("needs_review" if decision is None or decision["confidence"] == "low"
                   else "needs_budget" if decision["needsBudget"] else "no_budget")
            probabilities = one_hot(raw)
            gate_backend = "mock"
            signals = decision["signals"] if decision else ["Participant counts unknown; Jev projection skipped"]
            if raw == "needs_review":
                reasons.append("Jev has insufficient information for a confident decision")

        raw = max(probabilities, key=probabilities.get)
        confidence = probabilities[raw]
        if confidence < min_confidence:
            reasons.append("Classifier probability below the review threshold")
        if guarded is None:
            reasons.append("Expense facts are unknown; confirm coverage before funding")
        gate = {"label": "needs_review" if reasons else raw, "rawLabel": raw,
                "probabilities": probabilities, "confidence": confidence,
                "reviewReasons": reasons, "signals": signals, "backend": gate_backend, "modelId": model_id}
        validate(gate, "gate")
        wanted = expected.get(event["id"])
        rows.append({"eventId": event["id"], "request": request, "jev": decision,
                     "gate": gate, "tokenUsage": token_info, "expected": wanted,
                     "matchesExpected": gate["label"] == wanted if wanted else None})
    scored = [row for row in rows if row["expected"] is not None]
    matches = sum(row["matchesExpected"] for row in scored)
    counts = Counter(row["gate"]["label"] for row in rows)
    confusion = {label: {other: 0 for other in LABELS} for label in LABELS}
    for row in scored:
        confusion[row["expected"]][row["gate"]["label"]] += 1
    return {"schemaVersion": "1.0", "snapshotId": snapshot["snapshotId"], "backend": backend,
            "minConfidence": min_confidence, "probabilityNote": "mock/policy_guard distributions are deterministic encodings, not calibrated probabilities",
            "summary": {"eventCount": len(rows), "labels": {label: counts[label] for label in LABELS},
                        "scoredCount": len(scored), "matches": matches, "mismatches": len(scored) - matches,
                        "accuracy": matches / len(scored) if scored else None, "confusionMatrix": confusion},
            "results": rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=ROOT / "data/demo/month.json")
    parser.add_argument("--output", type=Path, default=ROOT / "data/harness/report.json")
    parser.add_argument("--backend", choices=("jev", "laya"), default="jev")
    parser.add_argument("--min-confidence", type=float, default=0.75)
    parser.add_argument("--expected", type=Path, help="JSON object mapping event IDs to human-authored gate labels")
    parser.add_argument("--fail-on-mismatch", action="store_true")
    args = parser.parse_args()
    if args.fail_on_mismatch and args.expected is None:
        parser.error("--fail-on-mismatch requires --expected")
    try:
        report = run(json.loads(args.input.read_text()), backend=args.backend,
                     min_confidence=args.min_confidence,
                     expected=json.loads(args.expected.read_text()) if args.expected else None)
    except (ValueError, OSError, ValidationError, ZoneInfoNotFoundError, subprocess.SubprocessError) as exc:
        parser.exit(2, f"Harness failed: {exc}\n")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(report, indent=2, allow_nan=False) + "\n")
    print(json.dumps(report["summary"], indent=2))
    print(f"Report: {args.output}")
    if args.fail_on_mismatch and report["summary"]["mismatches"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
