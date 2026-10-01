import assert from "node:assert/strict";
import test from "node:test";
import { mapEvent } from "./calendar";

type Input = Parameters<typeof mapEvent>[0];

function timed(overrides: Partial<Input> = {}): Input {
  return {
    id: "calendar-lunch",
    summary: "Lunch with client",
    location: "Midtown, New York",
    description: "<p>Discuss the renewal.</p>",
    start: { dateTime: "2026-10-06T12:30:00-04:00" },
    end: { dateTime: "2026-10-06T13:30:00-04:00" },
    attendees: [{ email: "client@example.com", displayName: "Client" }],
    ...overrides,
  };
}

test("single-day and multi-day all-day events are skipped without invented card windows", () => {
  for (const end of ["2026-10-07", "2026-10-10"]) {
    assert.equal(mapEvent(timed({ start: { date: "2026-10-06" }, end: { date: end } }), 0, "Waterloo"), null);
  }
});

test("mixed timed and all-day boundaries are skipped", () => {
  const inputs: Input[] = [
    timed({ start: { date: "2026-10-06" } }),
    timed({ end: { date: "2026-10-07" } }),
    timed({ start: { date: "2026-10-06", dateTime: "2026-10-06T12:30:00-04:00" } }),
    timed({ end: { date: "2026-10-07", dateTime: "2026-10-06T13:30:00-04:00" } }),
  ];
  for (const input of inputs) assert.equal(mapEvent(input, 0, "Waterloo"), null);
});

test("missing, malformed, impossible and offset-free timed boundaries are skipped", () => {
  const invalid = [
    "",
    "not-a-time",
    "2026-10-06",
    "2026-10-06T12:30:00",
    "2026-02-30T12:30:00-04:00",
    "2026-10-06T24:30:00-04:00",
    "2026-10-06T12:60:00-04:00",
    "2026-10-06T12:30:60-04:00",
    "2026-10-06T12:30:00+24:00",
  ];
  for (const dateTime of invalid) {
    assert.equal(mapEvent(timed({ start: { dateTime } }), 0, "Waterloo"), null, `Invalid start: ${dateTime}`);
    assert.equal(mapEvent(timed({ end: { dateTime } }), 0, "Waterloo"), null, `Invalid end: ${dateTime}`);
  }
  assert.equal(mapEvent(timed({ start: undefined }), 0, "Waterloo"), null);
  assert.equal(mapEvent(timed({ end: undefined }), 0, "Waterloo"), null);
});

test("event end must be later than start as an instant", () => {
  const invalidEnds = [
    "2026-10-06T12:30:00-04:00",
    "2026-10-06T12:00:00-04:00",
    "2026-10-06T16:30:00Z",
    "2026-10-06T13:30:00-03:00",
  ];
  for (const dateTime of invalidEnds) {
    assert.equal(mapEvent(timed({ end: { dateTime } }), 0, "Waterloo"), null);
  }
});

test("valid timed events preserve their original offset, timing and context", () => {
  const input = timed();
  const event = mapEvent(input, 0, "Waterloo");
  assert.ok(event);
  assert.equal(event.start, input.start?.dateTime);
  assert.equal(event.end, input.end?.dateTime);
  assert.equal(event.id, "calendar-lunch");
  assert.equal(event.title, "Lunch with client");
  assert.equal(event.city, "New York");
  assert.equal(event.description, "Discuss the renewal.");
  assert.deepEqual(event.attendees, [{ name: "Client", email: "client@example.com" }]);
});

test("valid UTC and positive-offset events remain timed without timezone rewriting", () => {
  const boundaries = [
    ["2026-10-06T08:00:00Z", "2026-10-06T09:00:00Z"],
    ["2026-10-06T12:30:00+05:30", "2026-10-06T13:30:00+05:30"],
    ["2026-10-06T12:30:00-04:00", "2026-10-06T17:00:00Z"],
  ];
  for (const [start, end] of boundaries) {
    const event = mapEvent(timed({ start: { dateTime: start }, end: { dateTime: end } }), 0, "Waterloo");
    assert.ok(event);
    assert.equal(event.start, start);
    assert.equal(event.end, end);
  }
});

test("a mixed import keeps only valid timed events and still skips canceled or declined events", () => {
  const inputs = [
    timed({ id: "single-day", start: { date: "2026-10-06" }, end: { date: "2026-10-07" } }),
    timed({ id: "multi-day", start: { date: "2026-10-06" }, end: { date: "2026-10-10" } }),
    timed({ id: "canceled", status: "cancelled" }),
    timed({ id: "declined", attendees: [{ email: "self@example.com", self: true, responseStatus: "declined" }] }),
    timed(),
  ];
  const events = inputs.map((input, index) => mapEvent(input, index, "Waterloo")).filter(Boolean);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.id, "calendar-lunch");
});
