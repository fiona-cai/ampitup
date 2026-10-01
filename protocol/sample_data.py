"""Generate reproducible dummy calendars conditioned on a supplied snapshot."""

import argparse
import copy
import json
import random
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from jsonschema.exceptions import ValidationError

from validate import validate

ROOT = Path(__file__).resolve().parent.parent


def sample(source, *, count=250, seed=42, start_date=None, days=31):
    validate(source)
    if not 1 <= count <= 10000 or not 1 <= days <= 366:
        raise ValueError("count must be 1–10000 and days must be 1–366")
    if not source["events"]:
        raise ValueError("Conditioning snapshot must contain at least one event")
    rng = random.Random(seed)
    zone = ZoneInfo(source["subject"]["timeZone"])
    first = start_date or datetime.fromisoformat(source["window"]["start"]).astimezone(zone).date()
    start = datetime.combine(first, time.min, zone)
    end = datetime.combine(first + timedelta(days=days), time.min, zone)
    snapshot = copy.deepcopy(source)
    snapshot.update(snapshotId=f"synthetic-{seed}-{first.isoformat()}-{count}",
                    generatedAt=start.astimezone(timezone.utc).isoformat(), isSimulated=True,
                    window={"start": start.isoformat(), "end": end.isoformat()}, events=[])
    snapshot["subject"]["id"] = f"synthetic-subject-{seed}"
    for i in range(count):
        event = copy.deepcopy(rng.choice(source["events"]))
        old_start = datetime.fromisoformat(event["schedule"]["start"])
        old_end = datetime.fromisoformat(event["schedule"]["end"])
        event_zone = ZoneInfo(event["schedule"]["timeZone"])
        if event["schedule"]["allDay"]:
            # Draw in the event's own zone, then check snapshot membership.
            choices = [datetime.combine(first + timedelta(days=n), time.min, event_zone)
                       for n in range(-1, days + 1)]
            choices = [item for item in choices if start <= item < end]
            new_start = rng.choice(choices)
            span = (old_end.astimezone(event_zone).date() - old_start.astimezone(event_zone).date()).days
            new_end = new_start + timedelta(days=span)
        else:
            old_local = old_start.astimezone(zone)
            new_start = datetime.combine(first + timedelta(days=rng.randrange(days)), old_local.timetz().replace(tzinfo=None), zone)
            # UTC arithmetic preserves actual duration through daylight saving.
            duration = old_end.astimezone(timezone.utc) - old_start.astimezone(timezone.utc)
            new_end = (new_start.astimezone(timezone.utc) + duration).astimezone(event_zone)
            new_start = new_start.astimezone(event_zone)
        record = f"sample-{seed}-{i:05}"
        event["id"] = f"synthetic:{record}"
        event["sources"] = [{"provider": "synthetic", "collectionId": snapshot["snapshotId"],
                             "recordId": record, "updatedAt": snapshot["generatedAt"], "url": None}]
        event["schedule"].update(start=new_start.isoformat(), end=new_end.isoformat())
        # Keep unknown/covered/zero facts intact; vary positive estimates only.
        for line in event["expenses"] or []:
            amount = line["estimatedAmountMinor"]
            if amount is not None and amount > 0:
                line["estimatedAmountMinor"] = min(100000000, max(1, round(amount * rng.uniform(0.8, 1.2))))
        snapshot["events"].append(event)
    snapshot["events"].sort(key=lambda event: (datetime.fromisoformat(event["schedule"]["start"]), event["id"]))
    validate(snapshot)
    return snapshot


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=ROOT / "data/demo/month.json")
    parser.add_argument("--output", type=Path, default=ROOT / "data/harness/samples.json")
    parser.add_argument("--count", type=int, default=250)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--days", type=int, default=31)
    parser.add_argument("--start", type=date.fromisoformat)
    args = parser.parse_args()
    try:
        payload = sample(json.loads(args.input.read_text()), count=args.count, seed=args.seed,
                         start_date=args.start, days=args.days)
    except (ValueError, OSError, ValidationError, ZoneInfoNotFoundError) as exc:
        parser.exit(2, f"Generation failed: {exc}\n")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"Generated {len(payload['events'])} validated synthetic events: {args.output}")


if __name__ == "__main__":
    main()
