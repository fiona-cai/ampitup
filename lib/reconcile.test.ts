import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { jevGate } from "./jev";
import { quoteFromPolicy } from "./price";
import { approveBudgeted, authorize, createLimit } from "./ramp";
import { reconcileEvents } from "./reconcile";
import { seedEvents } from "./seed";
import type { PricedEvent } from "./types";

function pricedSeed(): PricedEvent[] {
  return seedEvents().map((event) => {
    const jev = jevGate(event);
    return { event, jev, budget: jev.needsBudget ? quoteFromPolicy(event, jev) : null, approval: "pending", limit: null };
  });
}

async function spentLunch(amount = 25): Promise<PricedEvent[]> {
  const approved = approveBudgeted(pricedSeed());
  return authorize(approved, { amount, time: "2026-10-06T13:00:00-04:00", merchant: "Cafe", eventId: "solo-lunch" }).events;
}

describe("source reconciliation", () => {
  it("keeps approval and exact spending across unchanged sync", async () => {
    const previous = await spentLunch();
    const refreshed = reconcileEvents(previous, pricedSeed());
    const lunch = refreshed.find((item) => item.event.id === "solo-lunch")!;
    assert.equal(lunch.approval, "approved");
    assert.equal(lunch.limit?.spent, 25);
    assert.equal(authorize(refreshed, { amount: 1, time: lunch.event.start, merchant: "Cafe", eventId: lunch.event.id }).charge.result, "declined");
  });
  it("keeps spending through rejection and reapproval", async () => {
    const previous = (await spentLunch()).map((item) => item.event.id === "solo-lunch" ? { ...item, approval: "rejected" as const } : item);
    const refreshed = reconcileEvents(previous, pricedSeed());
    const lunch = refreshed.find((item) => item.event.id === "solo-lunch")!;
    assert.equal(lunch.approval, "rejected");
    assert.equal(lunch.archived, false);
    lunch.approval = "approved";
    lunch.limit = createLimit(lunch, lunch.limit);
    assert.equal(lunch.limit?.spent, 25);
    assert.equal(authorize(refreshed, { amount: 1, time: lunch.event.start, merchant: "Cafe", eventId: lunch.event.id }).charge.result, "declined");
  });
  it("requires review for changed times, source context, or quotes without replenishing money", async () => {
    const previous = await spentLunch();
    const fresh = pricedSeed();
    for (const change of [
      (item: PricedEvent) => ({ ...item, event: { ...item.event, start: "2026-10-06T13:00:00-04:00" } }),
      (item: PricedEvent) => ({ ...item, event: { ...item.event, description: "Updated meeting purpose" } }),
      (item: PricedEvent) => ({ ...item, budget: { ...item.budget!, amount: 20 } }),
    ]) {
      const incoming = fresh.map((item) => item.event.id === "solo-lunch" ? change(item) : item);
      const lunch = reconcileEvents(previous, incoming).find((item) => item.event.id === "solo-lunch")!;
      assert.equal(lunch.approval, "pending");
      assert.equal(lunch.limit?.spent, 25);
    }
  });
  it("keeps removed and no-budget records for audit, while preventing further charges", async () => {
    const previous = await spentLunch();
    const incoming = pricedSeed().filter((item) => item.event.id !== "solo-lunch");
    const refreshed = reconcileEvents(previous, incoming);
    const lunch = refreshed.find((item) => item.event.id === "solo-lunch")!;
    assert.equal(lunch.approval, "rejected");
    assert.equal(lunch.archived, true);
    assert.equal(lunch.limit?.spent, 25);
    assert.equal(authorize(refreshed, { amount: 1, time: lunch.event.start, merchant: "Cafe", eventId: lunch.event.id }).charge.result, "declined");
    const noBudget = reconcileEvents(previous, previous.map((item) => item.event.id === "solo-lunch" ? { ...item, budget: null } : item));
    assert.equal(noBudget.find((item) => item.event.id === "solo-lunch")?.limit?.spent, 25);
  });
  it("rejects duplicated incoming identities instead of creating extra funds", async () => {
    const fresh = pricedSeed();
    assert.throws(() => reconcileEvents([], [fresh[0], fresh[0]]), TypeError);
  });
  it("refuses funding removed or cancelled records even if their approval is tampered with", async () => {
    const previous = await spentLunch(10);
    const fresh = pricedSeed();
    const removed = reconcileEvents(previous, fresh.filter((item) => item.event.id !== "solo-lunch"));
    const cancelled = reconcileEvents(previous, fresh.map((item) => item.event.id === "solo-lunch"
      ? { ...item, event: { ...item.event, status: "cancelled" } } : item));
    for (const events of [removed, cancelled]) {
      const lunch = events.find((item) => item.event.id === "solo-lunch")!;
      assert.equal(lunch.archived, true);
      assert.equal(lunch.approval, "rejected");
      assert.equal(lunch.limit?.spent, 10);
      lunch.approval = "approved";
      assert.equal(createLimit(lunch, lunch.limit), lunch.limit);
      assert.equal(approveBudgeted(events).find((item) => item.event.id === "solo-lunch")?.approval, "rejected");
      assert.equal(authorize(events, { amount: 0.01, time: lunch.event.start, merchant: "Cafe", eventId: lunch.event.id }).charge.result, "declined");
    }
  });
  it("requires new review when an archived event reappears and retains prior spending", async () => {
    const previous = await spentLunch(10);
    const fresh = pricedSeed();
    const archived = reconcileEvents(previous, fresh.filter((item) => item.event.id !== "solo-lunch"));
    const refreshed = reconcileEvents(archived, fresh);
    const lunch = refreshed.find((item) => item.event.id === "solo-lunch")!;
    assert.equal(lunch.archived, false);
    assert.equal(lunch.approval, "pending");
    assert.equal(lunch.limit?.spent, 10);
    assert.equal(authorize(refreshed, { amount: 1, time: lunch.event.start, merchant: "Cafe", eventId: lunch.event.id }).charge.result, "declined");
    const approved = authorize(approveBudgeted(refreshed), { amount: 1, time: lunch.event.start, merchant: "Cafe", eventId: lunch.event.id });
    assert.equal(approved.charge.result, "approved");
    assert.equal(approved.events.find((item) => item.event.id === lunch.event.id)?.limit?.spent, 11);
  });
});
