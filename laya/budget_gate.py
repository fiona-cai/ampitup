"""JSON batch bridge for local Laya budget classification. No model downloads."""

import json
import sys
from pathlib import Path

import laya_mlx
from laya_mlx.common import build_prefix

MODEL_DIR = Path(__file__).resolve().parent / "models/english"
QUESTION = {"budget": {"type": "choice",
    "instructions": "Does this work event need new company funding? Use event facts and context; review unknown coverage. Calendar busyness alone does not justify spend.",
    "criteria": {"needs_budget": "An uncovered work expense is expected",
                 "no_budget": "No work expense, or everything is already covered",
                 "needs_review": "Purpose, attendance, or expense coverage is unclear"}}}


def state_for(request):
    event, context, policy = request["event"], request["context"], request["policy"]
    # Put structured facts before text so long connector descriptions cannot
    # truncate the policy or schedule evidence. Keep the full request in reports.
    return json.dumps({
        "scope": event["purpose"]["scope"], "status": event["status"], "attendance": event["attendance"],
        "expenses": event["expenses"], "participants": event["participants"],
        "difficulty": event["purpose"]["difficulty"], "importance": event["purpose"]["importance"],
        "mode": event["location"]["mode"], "mealTime": context["nearMealTime"],
        "day": context["day"], "week": context["week"], "transition": context["transition"],
        "policy": {"fundingScope": policy["fundingScope"], "currency": policy["currency"]},
        "title": event["title"], "location": event["location"]["label"], "description": event["description"],
    }, ensure_ascii=False, separators=(",", ":"))


def main():
    if not (MODEL_DIR / "model.safetensors").is_file():
        raise SystemExit("Laya model is missing; run laya/setup.sh first")
    requests = json.load(sys.stdin)
    agent = laya_mlx.load(str(MODEL_DIR))
    internal = agent._to_internal(QUESTION["budget"])
    prefix, _ = build_prefix(agent.tok, internal, agent.cfg.get("head_max_len", 192))
    room = agent.cfg.get("max_len", 512) - len(prefix) - 1
    results = []
    for request in requests:
        state = state_for(request)
        state_tokens = agent.tok(state.replace(agent.tok.mask_token, " "))["input_ids"]
        prediction = agent.predict(state, QUESTION)
        probabilities = prediction["answers"]["budget"]["probabilities"]
        total = sum(probabilities.values())
        results.append({"probabilities": {key: value / total for key, value in probabilities.items()},
                        "modelId": "aac6fef/laya-mlx@20aed815fc6acde75733882e7ec0e3f28aeb9717",
                        "inputTokens": prediction["usage"]["input_tokens"], "truncated": len(state_tokens) > room})
    json.dump(results, sys.stdout, allow_nan=False)


if __name__ == "__main__":
    main()
