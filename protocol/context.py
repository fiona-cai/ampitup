"""Derive schedule features without sending a month of text to the classifier."""

from datetime import datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo


def instant(value):
    return datetime.fromisoformat(value).astimezone(timezone.utc)


def active(event):
    return event["status"] != "cancelled" and event["attendance"] != "declined"


def union_minutes(intervals):
    total = 0
    left = right = None
    for start, end in sorted(intervals):
        if left is None:
            left, right = start, end
        elif start <= right:
            right = max(right, end)
        else:
            total += (right - left).total_seconds() / 60
            left, right = start, end
    if left is not None:
        total += (right - left).total_seconds() / 60
    return total


def context_for(event, snapshot):
    zone = ZoneInfo(snapshot["subject"]["timeZone"])
    start = instant(event["schedule"]["start"])
    end = instant(event["schedule"]["end"])
    local = start.astimezone(zone)
    date = local.date()
    monday = date - timedelta(days=date.weekday())
    window_start = instant(snapshot["window"]["start"])
    window_end = instant(snapshot["window"]["end"])

    def load(first, length):
        from_time = datetime.combine(first, time.min, zone).astimezone(timezone.utc)
        until_time = datetime.combine(first + timedelta(days=length), time.min, zone).astimezone(timezone.utc)
        selected, intervals = [], []
        for other in snapshot["events"]:
            if not active(other):
                continue
            left = max(instant(other["schedule"]["start"]), from_time, window_start)
            right = min(instant(other["schedule"]["end"]), until_time, window_end)
            if left >= right:
                continue
            selected.append(other)
            if not other["schedule"]["allDay"]:
                intervals.append((left, right))
        return {
            "eventCount": len(selected), "busyMinutes": union_minutes(intervals),
            "highDifficultyCount": sum(item["purpose"]["difficulty"] == "high" for item in selected),
            "allDayCount": sum(item["schedule"]["allDay"] for item in selected),
            "complete": window_start <= from_time and until_time <= window_end,
        }

    prior = [other for other in snapshot["events"] if active(other) and other["id"] != event["id"]
             and not other["schedule"]["allDay"] and instant(other["schedule"]["start"]) < start
             and instant(other["schedule"]["start"]).astimezone(zone).date() == date]
    previous = max(prior, key=lambda item: instant(item["schedule"]["end"])) if prior else None
    gap = (start - instant(previous["schedule"]["end"])).total_seconds() / 60 if previous else None
    travel = event["location"]["travelFromPreviousMinutes"]
    pressure = gap < travel if gap is not None and travel is not None else None
    return {
        "date": date.isoformat(), "weekStart": monday.isoformat(),
        "durationMinutes": (end - start).total_seconds() / 60,
        "day": load(date, 1), "week": load(monday, 7),
        "nearMealTime": 6 <= local.hour < 10 or 11 <= local.hour < 15 or 17 <= local.hour < 22,
        "transition": {"previousEventId": previous["id"] if previous else None,
                       "gapMinutes": gap, "travelMinutes": travel, "timePressure": pressure},
    }
