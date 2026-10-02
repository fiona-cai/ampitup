import assert from "node:assert/strict";
import test from "node:test";
import { createLimit } from "./ramp";
import { avatarFor, eventCounts, eventStatus, eventWindow, filterEvents, latestChargeFor, pipelineGate } from "./ui-events";
import { formatTime } from "./time";
import type { ChargeAttempt, PricedEvent } from "./types";

function event(overrides: Partial<PricedEvent> = {}): PricedEvent {
  return {
    event: { id: "lunch", title: "Solo lunch", description: "Lunch after landing", location: "Sweetgreen, Midtown", city: "New York", start: "2026-10-06T12:45:00-04:00", end: "2026-10-06T13:30:00-04:00", attendees: [{ name: "Maya Chen", email: "maya@example.com" }] },
    jev: { needsBudget: true, reason: "Meal", confidence: "high", category: "meal", rule: "solo_meal", signals: [] },
    budget: { amount: 25, currency: "USD", category: "meal", reason: "Policy", policyRule: "lunch", source: "policy", rawAmount: 25, clamped: false, cap: 25 },
    approval: "pending", limit: null, ...overrides,
  };
}

test("each event belongs to exactly one status group and overview counts all events", () => {
  const pending = event();
  const live = event({ approval: "approved" });
  live.limit = createLimit(live);
  const rejected = event({ approval: "rejected" });
  const noBudget = event({ budget: null });
  const approvedWithoutLimit = event({ approval: "approved" });
  assert.equal(eventStatus(pending), "review");
  assert.equal(eventStatus(live), "live");
  assert.equal(eventStatus(rejected), "none");
  assert.equal(eventStatus(approvedWithoutLimit), "review");
  assert.deepEqual(eventCounts([pending, live, rejected, noBudget, approvedWithoutLimit]), { overview: 5, review: 2, live: 1, none: 2 });
  assert.deepEqual(eventCounts([]), { overview: 0, review: 0, live: 0, none: 0 });
});

test("pipeline bins separate skipped, confident, and doubtful budgets", () => {
  assert.equal(pipelineGate(event()), "needs_budget");
  assert.equal(pipelineGate(event({ budget: null })), "no_budget");
  assert.equal(pipelineGate(event({ archived: true })), "no_budget");
  assert.equal(pipelineGate(event({ jev: { ...event().jev, needsBudget: false } })), "no_budget");
  assert.equal(pipelineGate(event({ jev: { ...event().jev, confidence: "low" } })), "needs_review");
  assert.equal(pipelineGate(event({ budget: { ...event().budget!, clamped: true } })), "needs_review");
  assert.equal(pipelineGate(event({ jev: { ...event().jev, rule: "classifier" } })), "needs_review");
  assert.equal(pipelineGate(event({ event: { ...event().event, location: "" } })), "needs_review");
});

test("tab, category, confidence and case-insensitive text filters intersect without mutating input", () => {
  const lunch = event();
  const vague = event({ event: { ...lunch.event, id: "coffee", title: "Catch up with Jordan", location: "Cafe Integral", attendees: [{ name: "Jordan Hale", email: "jordan@brightpath.io" }] }, jev: { ...lunch.jev, confidence: "low", category: "default_per_diem" }, budget: { ...lunch.budget!, category: "default_per_diem" } });
  const approved = event({ approval: "approved", event: { ...lunch.event, id: "dinner" } });
  approved.limit = createLimit(approved);
  const input = [lunch, vague, approved];
  const snapshot = JSON.stringify(input);
  assert.deepEqual(filterEvents(input, "review", { query: "  JORDAN  ", lowConfidenceOnly: true, category: "default_per_diem" }), [vague]);
  assert.deepEqual(filterEvents(input, "overview", { query: "brightpath.io" }), [vague]);
  assert.deepEqual(filterEvents(input, "overview", { query: "midtown", category: "all" }), [lunch, approved]);
  assert.deepEqual(filterEvents(input, "live", { query: "jordan" }), []);
  assert.deepEqual(filterEvents(input, "review", { query: "", category: "transport" }), []);
  assert.equal(JSON.stringify(input), snapshot);
});

function charge(id: string, eventId: string | null, time: string): ChargeAttempt {
  return { id, eventId, eventTitle: "Solo lunch", merchant: "Cafe", amount: 10, time, result: "approved", detail: "Simulated", report: null };
}
test("latest charge uses identity and instant rather than array ordering or equal titles", () => {
  const latest = charge("latest", "lunch", "2026-10-06T13:00:00-04:00");
  const older = charge("older", "lunch", "2026-10-06T16:50:00Z");
  const other = charge("other", "other-event", "2026-10-06T14:00:00-04:00");
  const invalid = charge("invalid", "lunch", "not-a-date");
  const unassigned = charge("unassigned", null, "2026-10-06T15:00:00-04:00");
  assert.equal(latestChargeFor("lunch", [latest, older, other, invalid, unassigned]), latest);
  assert.equal(latestChargeFor("missing", [latest, other]), undefined);
  const tie = charge("same-time-last", "lunch", latest.time);
  assert.equal(latestChargeFor("lunch", [latest, tie]), tie);
});

test("display window agrees with createLimit for meals and transport, including midnight", () => {
  for (const item of [event(), event({ budget: { ...event().budget!, category: "transport" } }), event({ event: { ...event().event, start: "2026-10-06T00:15:00-04:00", end: "2026-10-06T00:45:00-04:00" } })]) {
    const limit = createLimit(item)!;
    assert.equal(eventWindow(item), `${formatTime(limit.activeFrom)}–${formatTime(limit.activeUntil)}`);
    const withLimit = { ...item, limit };
    assert.equal(eventWindow(withLimit), eventWindow(item));
  }
  assert.equal(eventWindow(event({ approval: "rejected" })), "—");
  assert.equal(eventWindow(event({ budget: null })), "—");
  assert.equal(eventWindow(event({ event: { ...event().event, start: "2026-02-30T12:00:00-05:00" } })), "—");
  assert.equal(eventWindow(event({ event: { ...event().event, end: "2026-10-06T12:00:00-04:00" } })), "—");
});

test("brand and person avatars are deterministic without making financial claims", () => {
  const lunch = event();
  assert.deepEqual(avatarFor(lunch), { className: "amazon", label: "" });
  assert.deepEqual(avatarFor(event({ event: { ...lunch.event, title: "Dinner with Acme" } })), { className: "sg", label: "ac" });
  assert.deepEqual(avatarFor(event({ event: { ...lunch.event, title: "Team standup", location: "Zoom" } })), { className: "zoom", label: "zoom" });
  assert.deepEqual(avatarFor(event({ budget: { ...lunch.budget!, category: "transport" } })), { className: "delta", label: "" });
  const jordan = event({ event: { ...lunch.event, title: "Catch up with Jordan", attendees: [{ name: "Jordan Hale", email: "jordan@example.com" }] } });
  assert.equal(avatarFor(jordan).label, "jd");
  assert.deepEqual(avatarFor(jordan), avatarFor(jordan));
  const generic = event({ event: { ...lunch.event, id: "planning", title: "Product planning", attendees: [] } });
  assert.equal(avatarFor(generic).label, "pp");
  assert.ok(["indigo", "teal", "amber", "pink", "violet"].includes(avatarFor(generic).className));
});
