import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { applyStoredCharge, chargeFingerprint, ChargeConflictError } from "./charges";
import { createLimit } from "./ramp";
import { reconcileEvents } from "./reconcile";
import { blankState, readState, writeState } from "./store";
import type { AppState, PricedEvent } from "./types";

const time = "2026-10-06T12:00:00-04:00";
function fixture(): AppState {
  const event: PricedEvent = {
    event: { id: "lunch", title: "Lunch", description: "Meal", location: "NYC", start: time, end: "2026-10-06T13:00:00-04:00", city: "New York", attendees: [] },
    jev: { needsBudget: true, reason: "Meal", confidence: "high", category: "meal", rule: "solo_meal", signals: [] },
    budget: { amount: 100, currency: "USD", category: "meal", reason: "Policy", policyRule: "Meal cap", source: "policy", rawAmount: 100, clamped: false, cap: 100 },
    approval: "approved", limit: null,
  };
  event.limit = createLimit(event);
  return { ...blankState(), synced: true, events: [event] };
}
const input = { amount: 10, time, merchant: "Cafe", eventId: "lunch", requestId: "charge-1" };

describe("durable charge request idempotency", () => {
  it("serialized duplicate requests debit once and reuse the original result", async () => {
    let state = fixture();
    let queue = Promise.resolve();
    const results: ReturnType<typeof applyStoredCharge>[] = [];
    const submit = () => {
      queue = queue.then(() => { const result = applyStoredCharge(state, input); state = result.state; results.push(result); });
      return queue;
    };
    await Promise.all([submit(), submit(), submit()]);
    assert.equal(state.events[0].limit?.spent, 10);
    assert.equal(state.charges.length, 1);
    assert.equal(Object.keys(state.chargeRequests ?? {}).length, 1);
    assert.deepEqual(results.map((result) => result.replayed), [false, true, true]);
    assert.ok(results.every((result) => result.charge.id === results[0].charge.id));
  });

  it("canonical amount, offset and whitespace-equivalent requests share one receipt", () => {
    const first = applyStoredCharge(fixture(), input);
    const repeated = applyStoredCharge(first.state, { ...input, time: "2026-10-06T16:00:00.000Z", merchant: "  Cafe  " });
    assert.equal(chargeFingerprint(input), chargeFingerprint({ ...input, time: "2026-10-06T16:00:00Z", merchant: "Cafe " }));
    assert.equal(repeated.charge.id, first.charge.id);
    assert.equal(repeated.state.events[0].limit?.spent, 10);
  });

  it("reusing a request ID with different money, merchant, instant or event conflicts", () => {
    const first = applyStoredCharge(fixture(), input);
    for (const changes of [{ amount: 11 }, { merchant: "Other cafe" }, { time: "2026-10-06T12:01:00-04:00" }, { eventId: "other-event" }]) {
      assert.throws(() => applyStoredCharge(first.state, { ...input, ...changes }), ChargeConflictError);
    }
    assert.equal(first.state.events[0].limit?.spent, 10);
    assert.equal(first.state.charges.length, 1);
  });

  it("replays an approval after rejection, disappearance, persistence and recent-history eviction", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "allot-charge-test-"));
    const file = path.join(directory, "state.json");
    try {
      const first = applyStoredCharge(fixture(), input);
      let state = first.state;
      for (let index = 0; index < 15; index++) {
        state = applyStoredCharge(state, { ...input, amount: 1, requestId: `later-${index}` }).state;
      }
      assert.equal(state.charges.length, 12);
      assert.ok(!state.charges.some((charge) => charge.id === first.charge.id));
      assert.equal(Object.keys(state.chargeRequests ?? {}).length, 16);
      state = { ...state, events: reconcileEvents(state.events, []) };
      assert.equal(state.events[0].approval, "rejected");
      writeState(state, file);
      const restored = readState(file);
      const replay = applyStoredCharge(restored, input);
      assert.equal(replay.replayed, true);
      assert.deepEqual(replay.charge, first.charge);
      assert.equal(replay.state.events[0].limit?.spent, 25);
      assert.equal(replay.state.charges.length, 12);
      assert.equal(replay.state.charges.filter((charge) => charge.id === first.charge.id).length, 1);
      assert.equal(Object.keys(replay.state.chargeRequests ?? {}).length, 16);
      assert.deepEqual(applyStoredCharge(replay.state, input).charge, first.charge);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("a completed decline stays declined after its budget is later changed", () => {
    const first = applyStoredCharge(fixture(), { ...input, amount: 150 });
    assert.equal(first.charge.result, "declined");
    const event = first.state.events[0];
    const raised = { ...event, budget: { ...event.budget!, amount: 200, cap: 200 } };
    raised.limit = createLimit(raised, raised.limit);
    const replay = applyStoredCharge({ ...first.state, events: [raised] }, { ...input, amount: 150 });
    assert.equal(replay.charge.id, first.charge.id);
    assert.equal(replay.charge.result, "declined");
    assert.equal(replay.state.events[0].limit?.spent, 0);
  });

  it("legacy requests without an ID remain separate attempts", () => {
    const legacy = { amount: input.amount, time: input.time, merchant: input.merchant, eventId: input.eventId };
    const first = applyStoredCharge(fixture(), legacy);
    const second = applyStoredCharge(first.state, legacy);
    assert.notEqual(second.charge.id, first.charge.id);
    assert.equal(second.state.events[0].limit?.spent, 20);
    assert.equal(second.state.charges.length, 2);
    assert.equal(Object.keys(second.state.chargeRequests ?? {}).length, 0);
  });

  it("reserved object-property request IDs are stored and matched safely", () => {
    const first = applyStoredCharge(fixture(), { ...input, requestId: "__proto__" });
    assert.equal(Object.hasOwn(first.state.chargeRequests!, "__proto__"), true);
    assert.equal(applyStoredCharge(first.state, { ...input, requestId: "__proto__" }).charge.id, first.charge.id);
  });
});
