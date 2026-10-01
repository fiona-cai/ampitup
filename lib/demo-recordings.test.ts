import test from "node:test";
import assert from "node:assert/strict";
import { recordings, replayPlan } from "./demo-recordings";
import { validateAllocations } from "./luna-allocator";

test("verified replay preserves the separate Jev and Luna stages", () => {
  const classified = replayPlan({ action: "classify" }, false);
  assert.equal(classified.execution?.source, "recorded");
  assert.equal(classified.pricing.state, "not_run");
  assert.equal(classified.gateModel.calledEvents, 29);
  assert.ok(classified.events.every((r) => r.classifier && !r.allocation));
  const priced = replayPlan({ action: "allocate" }, false);
  assert.equal(priced.pricing.state, "complete");
  assert.equal(priced.pricing.calledEvents, priced.events.filter((r) => r.need !== "no_budget").length);
  assert.ok(priced.events.filter((r) => r.need === "no_budget").every((r) => !r.allocation));
  assert.equal(validateAllocations({ allocations: recordings.standard.quotes }, classified).length, 10);
});

test("replay refuses new context instead of pretending to rerun models", () => {
  assert.throws(() => replayPlan({ action: "allocate", settings: { spentWeeklyMinor: 27000 } }, false), /no verified recording/);
  assert.throws(() => replayPlan({ action: "allocate", dataset: "samples" }, false), /no verified recording/);
  assert.throws(() => replayPlan({ action: "feedback" }, false), /read-only/);
});

test("the tight-wallet recording and cached review obey cumulative funds", () => {
  const plan = replayPlan({ action: "allocate", settings: recordings.tight.settings }, false);
  assert.equal(plan.wallet.availableWeeklyMinor, 12000);
  assert.equal(plan.wallet.plannedMinor, 12000);
  assert.equal(plan.wallet.remainingWeeklyMinor, 0);
  const dinner = plan.events.find((r) => r.event.title === "Partner dinner")!;
  const rejected = replayPlan({ action: "preview", settings: plan.settings, runId: plan.runId, approvals: { [dinner.event.id]: "rejected" } }, false);
  assert.equal(rejected.wallet.remainingWeeklyMinor, 5500);
  assert.equal(rejected.wallet.plannedMinor, 6500);
  assert.equal(rejected.events.find((r) => r.event.id === dinner.event.id)?.status, "rejected");
});
