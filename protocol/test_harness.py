import copy
import json
import unittest
from datetime import date
from pathlib import Path

from context import context_for
from harness import guard, run
from sample_data import sample
from validate import validate

ROOT = Path(__file__).resolve().parent.parent
SNAPSHOT = json.loads((ROOT / "data/demo/month.json").read_text())


class HarnessTests(unittest.TestCase):
    def test_mixed_coverage_keeps_unpaid_transport(self):
        event = next(event for event in SNAPSHOT["events"] if event["title"].startswith("Workshop;"))
        self.assertEqual(guard(event)[0], "needs_budget")
        covered = copy.deepcopy(event)
        covered["expenses"][1]["coverage"] = "prepaid"
        self.assertEqual(guard(covered)[0], "no_budget")

    def test_unknown_is_distinct_from_confirmed_no_expense(self):
        event = copy.deepcopy(SNAPSHOT["events"][0])
        self.assertEqual(guard(event)[0], "no_budget")
        event["expenses"] = None
        self.assertIsNone(guard(event)[0])
        event["purpose"]["scope"] = "unknown"
        self.assertEqual(guard(event)[0], "needs_review")

    def test_cancelled_declined_and_personal_are_never_funded(self):
        for title in ("Cancelled customer coffee", "Declined vendor dinner", "Personal brunch with friends"):
            event = next(event for event in SNAPSHOT["events"] if event["title"] == title)
            self.assertEqual(guard(event)[0], "no_budget")

    def test_context_unions_overlaps_and_excludes_inactive_events(self):
        source = copy.deepcopy(SNAPSHOT)
        event = source["events"][0]
        overlapping = copy.deepcopy(event)
        overlapping["id"] = "overlap"
        overlapping["schedule"].update(start="2026-10-01T09:10:00-04:00", end="2026-10-01T09:40:00-04:00")
        cancelled = copy.deepcopy(overlapping)
        cancelled["id"] = "cancelled"
        cancelled["status"] = "cancelled"
        source["events"] = [event, overlapping, cancelled]
        context = context_for(event, source)
        self.assertEqual(context["day"]["busyMinutes"], 40)
        self.assertEqual(context["day"]["eventCount"], 2)
        self.assertTrue(context["day"]["complete"])
        self.assertFalse(context["week"]["complete"])

    def test_sampler_reproducibility_and_daylight_saving(self):
        first = sample(SNAPSHOT, count=80, seed=21, start_date=date(2026, 11, 1), days=7)
        self.assertEqual(first, sample(SNAPSHOT, count=80, seed=21, start_date=date(2026, 11, 1), days=7))
        self.assertNotEqual(first, sample(SNAPSHOT, count=80, seed=22, start_date=date(2026, 11, 1), days=7))
        validate(first)
        self.assertEqual(len({event["id"] for event in first["events"]}), 80)
        self.assertTrue(first["isSimulated"])
        self.assertTrue(any(event["schedule"]["allDay"] for event in first["events"]))

    def test_sampler_accepts_non_demo_subject_and_policy(self):
        source = copy.deepcopy(SNAPSHOT)
        source["subject"]["timeZone"] = "Asia/Tokyo"
        source["policy"]["currency"] = "JPY"
        output = sample(source, count=25, days=3)
        self.assertEqual(output["policy"], source["policy"])
        self.assertEqual(output["subject"]["timeZone"], "Asia/Tokyo")
        validate(output)

    def test_gate_request_rejects_cross_field_invariants(self):
        event = copy.deepcopy(SNAPSHOT["events"][0])
        event["participants"].update(totalCount=1, externalCount=2)
        request = {"schemaVersion": "1.0", "requestId": "invalid", "event": event,
                   "context": context_for(event, SNAPSHOT), "policy": SNAPSHOT["policy"]}
        with self.assertRaisesRegex(ValueError, "externalCount"):
            validate(request, "gateRequest")

    def test_real_jev_batch_against_authored_fixture_labels(self):
        expected = json.loads((ROOT / "data/demo/expected.json").read_text())
        report = run(SNAPSHOT, expected=expected)
        self.assertEqual(report["summary"]["scoredCount"], 118)
        self.assertEqual(report["summary"]["mismatches"], 0)
        mixed = next(row for row in report["results"] if row["request"]["event"]["title"].startswith("Workshop;"))
        self.assertFalse(mixed["jev"]["needsBudget"])
        self.assertEqual(mixed["gate"]["label"], "needs_budget")
        unknown = next(row for row in report["results"] if row["request"]["event"]["expenses"] is None)
        self.assertEqual(unknown["gate"]["label"], "needs_review")

    def test_empty_snapshot_and_invalid_expected_labels(self):
        source = {**SNAPSHOT, "events": []}
        self.assertEqual(run(source)["summary"]["eventCount"], 0)
        with self.assertRaisesRegex(ValueError, "absent"):
            run(source, expected={"not-an-event": "needs_budget"})
        with self.assertRaisesRegex(ValueError, "Conditioning"):
            sample(source)


if __name__ == "__main__":
    unittest.main()
