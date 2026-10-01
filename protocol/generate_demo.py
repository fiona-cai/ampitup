"""Generate deterministic normalized dummy data for October 2026."""

import json
from datetime import date, datetime, time, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parent.parent
ZONE = ZoneInfo("America/Toronto")
PROVIDERS = ["google_calendar", "notion", "outlook"]


def expense(category, amount=None, coverage="not_covered", people=1):
    return {"category": category, "coverage": coverage, "estimatedAmountMinor": amount,
            "beneficiaryCount": people, "notes": None}


def event(day, index, title, hour, minutes, *, expenses=None, scope="work", difficulty="moderate",
          importance="normal", mode="virtual", place="Online", external=0, city="Toronto", travel=0):
    provider = PROVIDERS[(day.day + index) % len(PROVIDERS)]
    record = f"2026-10-{day.day:02}-{index:02}"
    start = datetime.combine(day, time(hour // 60, hour % 60), ZONE)
    end = start + timedelta(minutes=minutes)
    item = {
        "id": f"{provider}:demo:{record}",
        "sources": [{"provider": provider, "collectionId": "demo-maya-october", "recordId": record,
                     "updatedAt": "2026-09-30T12:00:00-04:00", "url": None}],
        "title": title, "description": "Synthetic demo event. No real account was accessed.",
        "status": "confirmed", "attendance": "accepted",
        "schedule": {"start": start.isoformat(), "end": end.isoformat(), "timeZone": "America/Toronto", "allDay": False},
        "purpose": {"scope": scope, "importance": importance, "difficulty": difficulty},
        "location": {"mode": mode, "label": place, "city": city, "countryCode": "CA" if city else None,
                     "travelFromPreviousMinutes": travel},
        "participants": {"totalCount": 1 + external, "externalCount": external},
        "expenses": expenses, "missingFields": [],
    }
    if expenses is None:
        item["missingFields"].append("/expenses")
    if mode == "unknown":
        item["missingFields"].append("/location/mode")
    if city is None:
        item["missingFields"].append("/location/city")
    if scope == "unknown":
        item["missingFields"].append("/purpose/scope")
    return item


def snapshot():
    events = []
    for n in range(31):
        day = date(2026, 10, 1) + timedelta(days=n)
        if day.weekday() >= 5:
            events.append(event(day, 0, "Personal brunch with friends", 11 * 60, 90,
                                scope="personal", difficulty="low", mode="in_person", place="Neighbourhood cafe",
                                expenses=[expense("meal", 2800)], travel=None))
            continue
        # Workload differs by week; first and third full weeks are busier.
        busy = 5 <= day.day <= 9 or 19 <= day.day <= 23
        events.append(event(day, 0, "Team standup", 9 * 60, 25, difficulty="low", expenses=[]))
        events.append(event(day, 1, "Architecture review" if busy else "Project planning", 9 * 60 + 30,
                            120 if busy else 60, difficulty="high" if busy else "moderate", importance="high", expenses=[]))
        lunch_cases = [
            ("Client lunch", [expense("meal", 11000, people=3)], 2, "Restaurant", "in_person"),
            ("Workshop; lunch provided, taxi unpaid", [expense("meal", 0, "provided"), expense("transport", 2800)], 1, "Client office", "in_person"),
            ("Lunch at home", [], 0, "Home", "in_person"),
            ("Catch up with partner, details TBD", None, 1, None, "unknown"),
            ("Conference lunch included", [expense("meal", 0, "provided")], 0, "Conference venue", "in_person"),
        ]
        title, costs, external, place, mode = lunch_cases[day.day % 5]
        events.append(event(day, 2, title, 12 * 60, 60, expenses=costs, external=external, mode=mode, place=place,
                            city=None if mode == "unknown" else "Toronto", travel=40 if busy else 15))
        if busy:
            events.append(event(day, 3, "Release incident response", 13 * 60 + 10, 150,
                                difficulty="high", importance="high", expenses=[]))
            events.append(event(day, 4, "Onsite demo across town", 15 * 60 + 45, 60,
                                mode="in_person", place="Client campus", travel=45, external=2,
                                expenses=[expense("transport", None)]))
        else:
            events.append(event(day, 3, "Deep work", 14 * 60, 90, difficulty="high", expenses=[]))
        if day.weekday() == 3:
            events.append(event(day, 5, "Partner dinner", 18 * 60, 90, importance="high", external=3,
                                mode="in_person", place="Downtown restaurant", travel=20,
                                expenses=[expense("meal", 24000, people=4)]))
        if day.day in (7, 21):
            events.append(event(day, 6, "Flight already paid; ground transfer unpaid", 7 * 60, 75,
                                mode="in_person", place="Toronto Pearson airport", travel=None,
                                expenses=[expense("admission", 42000, "prepaid"), expense("transport", 6500)]))
        if day.day == 14:
            item = event(day, 6, "Cancelled customer coffee", 16 * 60, 30, expenses=[expense("coffee", 2000)],
                         external=1, mode="in_person", place="Cafe")
            item["status"] = "cancelled"
            events.append(item)
        if day.day == 16:
            item = event(day, 6, "Optional networking; attendance undecided", 18 * 60, 90,
                         expenses=[expense("admission", 4000, "unknown")], scope="unknown", external=5,
                         mode="in_person", place="Event space")
            item["attendance"] = "tentative"
            item["missingFields"].append("/expenses/0/coverage")
            events.append(item)
        if day.day == 20:
            item = event(day, 6, "Declined vendor dinner", 18 * 60, 90, expenses=[expense("meal", 9000)],
                         external=2, mode="in_person", place="Restaurant")
            item["attendance"] = "declined"
            events.append(item)
        if day.day == 28:
            item = event(day, 6, "All-day conference, registration prepaid", 0, 1440,
                         difficulty="high", mode="in_person", place="Convention centre",
                         expenses=[expense("admission", 18000, "prepaid")])
            item["schedule"]["allDay"] = True
            events.append(item)
    # One event appears in both calendar and Notion. It remains ONE event with two source references.
    shared = next(item for item in events if item["title"] == "Partner dinner")
    shared["sources"].append({"provider": "notion", "collectionId": "demo-projects", "recordId": "partner-dinner-brief",
                              "updatedAt": "2026-09-30T12:00:00-04:00", "url": None})
    events.sort(key=lambda item: (item["schedule"]["start"], item["id"]))
    return {
        "schemaVersion": "1.0", "snapshotId": "demo-maya-2026-10", "generatedAt": "2026-09-30T20:00:00Z",
        "isSimulated": True,
        "subject": {"id": "demo-maya", "timeZone": "America/Toronto", "homeCity": "Toronto"},
        "window": {"start": "2026-10-01T00:00:00-04:00", "end": "2026-11-01T00:00:00-04:00"},
        "policy": {
            "id": "demo-work-expenses-v1", "currency": "USD", "fundingScope": "work",
            "dailyLimitMinor": 30000, "weeklyLimitMinor": 80000, "monthlyLimitMinor": 200000,
            "categoryCapsMinor": {"meal": 28000, "coffee": 6000, "transport": 7500, "lodging": 20000,
                                  "admission": 10000, "supplies": 5000, "other": 3000},
        },
        "events": events,
    }


def main():
    payload = snapshot()
    path = ROOT / "data/demo/month.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2) + "\n")
    sample = {**payload, "snapshotId": "example-one-event", "events": [payload["events"][0]]}
    path = ROOT / "protocol/examples/event-snapshot.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(sample, indent=2) + "\n")
    print(f"Generated {len(payload['events'])} simulated events across October 2026")


if __name__ == "__main__":
    main()
