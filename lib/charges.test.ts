import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { applyStoredCharge, chargeFingerprint, ChargeConflictError } from "./charges";
import { createLimit } from "./ramp";
import { reconcileEvents } from "./reconcile";
import { blankState, readState, writeState } from "./store";
import { commitStateSnapshot, readStateSnapshot, StateConflictError } from "./store";
import { compareAndSetJson, readJsonSnapshot } from "./kv";
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

  it("replays an approval after rejection, disappearance, persistence and recent-history eviction", async () => {
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
      await writeState(state, file);
      const restored = await readState(file);
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

describe("whole-state compare-and-set protects independent server instances", () => {
  it("concurrent distinct charges cannot both consume the same remaining budget", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "allot-cas-test-"));
    const file = path.join(directory, "state.json");
    try {
      const initial = fixture();
      const event = initial.events[0];
      event.budget = { ...event.budget!, amount: 25, cap: 25 };
      event.limit = createLimit(event);
      await writeState(initial, file);
      // Two independent handlers computed approvals from the same $25 balance.
      const [firstSnapshot, staleSnapshot] = await Promise.all([readStateSnapshot(file), readStateSnapshot(file)]);
      const first = applyStoredCharge(firstSnapshot.state, { ...input, amount: 20 });
      const stale = applyStoredCharge(staleSnapshot.state, { ...input, amount: 20, requestId: "charge-2" });
      assert.equal(first.charge.result, "approved");
      assert.equal(stale.charge.result, "approved");
      await commitStateSnapshot(firstSnapshot, first.state, file);
      await assert.rejects(() => commitStateSnapshot(staleSnapshot, stale.state, file), StateConflictError);
      // The losing handler must read and recompute, not resend its stale result.
      const fresh = await readStateSnapshot(file);
      const retry = applyStoredCharge(fresh.state, { ...input, amount: 20, requestId: "charge-2" });
      assert.equal(retry.charge.result, "declined");
      await commitStateSnapshot(fresh, retry.state, file);
      const saved = await readState(file);
      assert.equal(saved.events[0].limit?.spent, 20);
      assert.equal(Object.keys(saved.chargeRequests ?? {}).length, 2);
      assert.equal(saved.chargeRequests?.["charge-1"].charge.result, "approved");
      assert.equal(saved.chargeRequests?.["charge-2"].charge.result, "declined");
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("same-ID concurrent handlers converge on one original receipt and one debit", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "allot-cas-test-"));
    const file = path.join(directory, "state.json");
    try {
      await writeState(fixture(), file);
      const [firstSnapshot, staleSnapshot] = await Promise.all([readStateSnapshot(file), readStateSnapshot(file)]);
      const first = applyStoredCharge(firstSnapshot.state, input);
      const stale = applyStoredCharge(staleSnapshot.state, input);
      await commitStateSnapshot(firstSnapshot, first.state, file);
      await assert.rejects(() => commitStateSnapshot(staleSnapshot, stale.state, file), StateConflictError);
      const fresh = await readStateSnapshot(file);
      const retry = applyStoredCharge(fresh.state, input);
      assert.equal(retry.replayed, true);
      assert.deepEqual(retry.charge, first.charge);
      await commitStateSnapshot(fresh, retry.state, file);
      const saved = await readState(file);
      assert.equal(saved.events[0].limit?.spent, 10);
      assert.equal(saved.charges.length, 1);
      assert.equal(Object.keys(saved.chargeRequests ?? {}).length, 1);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("stale sync or review cannot overwrite a newly committed debit", async () => {
    const directory = mkdtempSync(path.join(tmpdir(), "allot-cas-test-"));
    const file = path.join(directory, "state.json");
    try {
      await writeState(fixture(), file);
      const stale = await readStateSnapshot(file);
      const chargeSnapshot = await readStateSnapshot(file);
      await commitStateSnapshot(chargeSnapshot, applyStoredCharge(chargeSnapshot.state, input).state, file);
      const review = { ...stale.state, events: stale.state.events.map((event) => ({ ...event, approval: "rejected" as const })) };
      const sync = { ...stale.state, events: reconcileEvents(stale.state.events, []) };
      await assert.rejects(() => commitStateSnapshot(stale, review, file), StateConflictError);
      await assert.rejects(() => commitStateSnapshot(stale, sync, file), StateConflictError);
      assert.equal((await readState(file)).events[0].limit?.spent, 10);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("Redis CAS uses one EVAL and distinguishes a missing key from stored JSON null", async (context) => {
    const previousUrl = process.env.KV_REST_API_URL;
    const previousToken = process.env.KV_REST_API_TOKEN;
    process.env.KV_REST_API_URL = "https://redis.test";
    process.env.KV_REST_API_TOKEN = "test-only-token";
    const values = new Map<string, string>();
    const commands: Array<Array<string | number>> = [];
    context.mock.method(globalThis, "fetch", async (_url: unknown, init?: RequestInit) => {
      const command = JSON.parse(String(init?.body)) as Array<string | number>;
      commands.push(command);
      let result: unknown;
      if (command[0] === "GET") result = values.get(String(command[1])) ?? null;
      else {
        assert.equal(command[0], "EVAL");
        assert.equal(command[2], 1);
        assert.match(String(command[1]), /redis\.call\('GET', KEYS\[1\]\)/);
        assert.match(String(command[1]), /redis\.call\('SET', KEYS\[1\], ARGV\[3\]\)/);
        const [, , , key, exists, expected, next] = command;
        const current = values.get(String(key));
        const match = exists === "0" ? current === undefined : current === expected;
        if (match) values.set(String(key), String(next));
        result = match ? 1 : 0;
      }
      return Response.json({ result });
    });
    try {
      assert.equal(await compareAndSetJson("state", null, { balance: 25 }), true);
      assert.deepEqual(commands.map((command) => command[0]), ["EVAL"]);
      assert.equal(await compareAndSetJson("state", null, { balance: 50 }), false);
      values.set("allot:state", "null");
      const snapshot = await readJsonSnapshot("state");
      assert.deepEqual(snapshot, { value: null, raw: "null" });
      assert.equal(await compareAndSetJson("state", null, {}), false);
      assert.equal(await compareAndSetJson("state", snapshot.raw, { balance: 10 }), true);
      assert.equal(values.get("allot:state"), '{"balance":10}');
    } finally {
      if (previousUrl === undefined) delete process.env.KV_REST_API_URL; else process.env.KV_REST_API_URL = previousUrl;
      if (previousToken === undefined) delete process.env.KV_REST_API_TOKEN; else process.env.KV_REST_API_TOKEN = previousToken;
    }
  });
});
