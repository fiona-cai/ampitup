import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { toCents, fromCents } from "./money";
import { authorize, createLimit } from "./ramp";
import { formatMoney, parseInstant } from "./time";
import type { PricedEvent } from "./types";

const start = "2026-10-06T12:00:00-04:00";
const end = "2026-10-06T13:00:00-04:00";
function fixture(id = "lunch", amount = 25): PricedEvent {
  const item: PricedEvent = {
    event: { id, title: id, description: "Lunch", location: "NYC", start, end, city: "New York", attendees: [] },
    jev: { needsBudget: true, reason: "Meal", confidence: "high", category: "meal", rule: "solo_meal", signals: [] },
    budget: { amount, currency: "USD", category: "meal", reason: "Policy", policyRule: "Meal cap", source: "policy", rawAmount: amount, clamped: false, cap: amount },
    approval: "approved", limit: null,
  };
  item.limit = createLimit(item);
  return item;
}
const charge = { amount: 10, time: start, merchant: "Cafe" };

describe("exact charge arithmetic", () => {
  it("spends 24.80 and 0.20 exactly, then rejects another cent", () => {
    let result = authorize([fixture()], { ...charge, amount: 24.8 });
    result = authorize(result.events, { ...charge, amount: 0.2 });
    assert.equal(result.charge.result, "approved");
    assert.equal(result.events[0].limit?.spent, 25);
    const declined = authorize(result.events, { ...charge, amount: 0.01 });
    assert.equal(declined.charge.result, "declined");
    assert.equal(declined.events[0].limit?.spent, 25);
  });
  it("validates cents and does not hide them in money formatting", () => {
    assert.equal(toCents(0.29), 29);
    assert.equal(fromCents(29), 0.29);
    assert.equal(formatMoney(24.8), "$24.80");
    assert.equal(formatMoney(25), "$25");
    for (const amount of [NaN, Infinity, -1, 0, 0.001, 10000.01]) {
      assert.throws(() => authorize([fixture()], { ...charge, amount }), TypeError);
    }
  });
  it("preserves an exhausted ledger when creating an updated limit", () => {
    const item = authorize([fixture()], { ...charge, amount: 25 }).events[0];
    const pending: PricedEvent = { ...item, approval: "pending" };
    pending.limit = createLimit(pending, item.limit);
    assert.equal(pending.limit?.spent, 25);
    const approved: PricedEvent = { ...pending, approval: "approved" };
    assert.equal(authorize([approved], charge).charge.result, "declined");
  });
});

describe("event-bound charge windows", () => {
  it("declines overlapping budgets unless a charge names one event", () => {
    const events = [fixture("lunch"), fixture("ride", 60)];
    assert.equal(authorize(events, charge).charge.result, "declined");
    const bound = authorize(events, { ...charge, eventId: "lunch" });
    assert.equal(bound.charge.eventId, "lunch");
    assert.equal(bound.events[0].limit?.spent, 10);
    assert.equal(bound.events[1].limit?.spent, 0);
    assert.equal(authorize(events, { ...charge, eventId: "unknown" }).charge.result, "declined");
  });
  it("includes the opening instant and excludes the closing instant", () => {
    const item = fixture();
    assert.equal(authorize([item], { ...charge, time: item.limit!.activeFrom }).charge.result, "approved");
    assert.equal(authorize([item], { ...charge, time: item.limit!.activeUntil }).charge.result, "declined");
  });
  it("never uses a different event when the named event is closed", () => {
    const lunch = fixture();
    const dinner = fixture("dinner", 50);
    dinner.event = { ...dinner.event, start: "2026-10-06T19:00:00-04:00", end: "2026-10-06T20:00:00-04:00" };
    dinner.limit = createLimit(dinner);
    const result = authorize([lunch, dinner], { ...charge, eventId: "lunch", time: dinner.event.start });
    assert.equal(result.charge.result, "declined");
    assert.equal(result.events[1].limit?.spent, 0);
  });
  it("rejects impossible dates and timestamps without timezone offsets", () => {
    for (const time of ["2026-02-30T12:00:00Z", "2026-10-06T12:00:00", "2026-10-06T24:00:00Z", "not-a-date"]) {
      assert.equal(parseInstant(time), null);
      assert.throws(() => authorize([fixture()], { ...charge, time }), TypeError);
    }
    assert.notEqual(parseInstant("2024-02-29T12:00:00Z"), null);
  });
});
