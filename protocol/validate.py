"""Validate wire shapes and cross-field invariants. No connector calls."""

import argparse
import json
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from jsonschema import Draft202012Validator, FormatChecker

SCHEMA = json.loads((Path(__file__).parent / "budget.schema.json").read_text())
FORMATS = FormatChecker()


@FORMATS.checks("date-time", raises=ValueError)
def valid_instant(value):
    if not isinstance(value, str):
        return True
    parsed = datetime.fromisoformat(value)
    return "T" in value and parsed.tzinfo is not None


def instant(value):
    return datetime.fromisoformat(value)


def validate(value, definition="snapshot"):
    schema = {"$schema": SCHEMA["$schema"], "$defs": SCHEMA["$defs"], "$ref": f"#/$defs/{definition}"}
    Draft202012Validator(schema, format_checker=FORMATS).validate(value)
    if definition == "snapshot":
        ZoneInfo(value["subject"]["timeZone"])
        start, end = map(instant, (value["window"]["start"], value["window"]["end"]))
        if start >= end:
            raise ValueError("window.end must be after window.start")
        seen = set()
        source_records = set()
        for event in value["events"]:
            validate(event, "event")
            if event["id"] in seen:
                raise ValueError(f"duplicate event ID: {event['id']}")
            seen.add(event["id"])
            if not start <= instant(event["schedule"]["start"]) < end:
                raise ValueError(f"{event['id']}: start lies outside snapshot window")
            for source in event["sources"]:
                key = (source["provider"], source["collectionId"], source["recordId"])
                if key in source_records:
                    raise ValueError(f"duplicate source record: {key}; merge provenance into one event")
                source_records.add(key)
    elif definition == "event":
        schedule = value["schedule"]
        zone = ZoneInfo(schedule["timeZone"])
        start, end = map(instant, (schedule["start"], schedule["end"]))
        if start >= end:
            raise ValueError(f"{value['id']}: end must be after start")
        for time in (start, end):
            if time.utcoffset() != time.astimezone(zone).utcoffset():
                raise ValueError(f"{value['id']}: timestamp offset disagrees with timeZone")
            if schedule["allDay"] and time.astimezone(zone).time().isoformat() != "00:00:00":
                raise ValueError("all-day boundaries must be local midnight")
        total = value["participants"]["totalCount"]
        external = value["participants"]["externalCount"]
        if total is not None and external is not None and external > total:
            raise ValueError("externalCount cannot exceed totalCount")
        for pointer in value["missingFields"]:
            current = value
            for part in pointer[1:].split("/"):
                part = part.replace("~1", "/").replace("~0", "~")
                current = current[int(part)] if isinstance(current, list) else current[part]
            if current not in (None, "unknown"):
                raise ValueError(f"{pointer} does not point to an unknown fact")
    elif definition == "gate":
        if abs(sum(value["probabilities"].values()) - 1) > 0.001:
            raise ValueError("gate probabilities must sum to one")
        label = max(value["probabilities"], key=value["probabilities"].get)
        if value["rawLabel"] != label:
            raise ValueError("rawLabel must be the highest-probability class")
        if abs(value["confidence"] - value["probabilities"][label]) > 0.001:
            raise ValueError("confidence must equal the selected probability")
    elif definition in ("gateRequest", "pricingRequest"):
        validate(value["event"], "event")
        if definition == "pricingRequest":
            validate(value["gate"], "gate")
            if value["gate"]["label"] == "no_budget":
                raise ValueError("no_budget events do not go to the budget model")
    elif definition == "budgetProposal":
        if value["amountMinor"] != sum(line["amountMinor"] for line in value["lineItems"]):
            raise ValueError("amountMinor must equal the line-item total")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("paths", nargs="+", type=Path)
    parser.add_argument("--definition", choices=SCHEMA["$defs"], default="snapshot")
    args = parser.parse_args()
    Draft202012Validator.check_schema(SCHEMA)
    for path in args.paths:
        validate(json.loads(path.read_text()), args.definition)
        print(f"Valid {args.definition}: {path}")


if __name__ == "__main__":
    main()
