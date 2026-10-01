import assert from "node:assert/strict";
import { it } from "node:test";
import fixture from "../data/demo/month.json";
import { buildContexts, instantInZone, midnight } from "./event-context";
import { defaultSettings, planWithJev } from "./jev-conditioned";
import { allocatorInput, validateAllocations } from "./luna-allocator";
import { validateSnapshot } from "./snapshot-validation";
import type { EventSnapshot, NormalizedEvent } from "./budget-protocol";
import type { AllocationQuote, Assignment, LayaGate } from "./demo-types";

const snapshot = validateSnapshot(fixture);
const gate: LayaGate = { rawLabel: "needs_budget", probabilities: { needs_budget: .8, no_budget: .1, needs_review: .1 }, confidence: .8, inputTokens: 250, truncated: false, override: null };

function singleEvent(title: string): { source: EventSnapshot; event: NormalizedEvent } {
  const event = structuredClone(snapshot.events.find((item) => item.title === title)!);
  const source = { ...snapshot, events: [event] };
  return { source, event };
}

function settingsFor(source: EventSnapshot) {
  return { ...defaultSettings(source), weekStart: buildContexts(source).values().next().value!.weekStart, spentWeeklyMinor: 0, spentMonthlyMinor: 0 };
}

function quote(event: NormalizedEvent, amount = 5000, category = "transport"): AllocationQuote {
  return { eventId: event.id, amountMinor: amount, lineItems: [{ category, amountMinor: amount }], rationale: "Confirmed unpaid work expense, within available funds.", historyIds: [], questions: [] };
}

it("uses local-zone days, overlap unions, and DST midnight boundaries", () => {
  assert.equal(instantInZone(midnight("2026-11-02", "America/Toronto"), "America/Toronto"), "2026-11-02T00:00:00-05:00");
  assert.equal((midnight("2026-11-02", "America/Toronto") - midnight("2026-11-01", "America/Toronto")) / 3600000, 25);
  const contexts = buildContexts(snapshot);
  const first = contexts.get(snapshot.events[0].id)!;
  assert.equal(first.week.complete, false);
  assert.equal(first.day.complete, true);
});

it("keeps the three gates separate from the LLM amount and prevents funding covered facts", () => {
  const { source, event } = singleEvent("Team standup");
  const plan = planWithJev(source, settingsFor(source), { gates: { [event.id]: gate } });
  assert.equal(plan.events[0].need, "no_budget");
  assert.ok(plan.events[0].classifier?.override);
  assert.equal(allocatorInput(plan).events.length, 0);
});

it("conditions feasibility on actual travel gaps and event duration", () => {
  const source = structuredClone(snapshot);
  const lunch = source.events.find((event) => event.title === "Client lunch" && event.schedule.start.startsWith("2026-10-05"))!;
  const settings = { ...defaultSettings(source), maxWeeklyHours: 168, maxDailyHours: 24 };
  let row = planWithJev(source, settings, { gates: { [lunch.id]: gate } }).events.find((item) => item.event.id === lunch.id)!;
  assert.equal(row.need, "needs_review");
  assert.equal(row.feasibility.travelShortfallMinutes, 10);
  const previous = source.events.find((event) => event.id === row.context.transition.previousEventId)!;
  previous.schedule.end = instantInZone(Date.parse(previous.schedule.start) + 30 * 60000, previous.schedule.timeZone);
  row = planWithJev(source, settings, { gates: { [lunch.id]: gate } }).events.find((item) => item.event.id === lunch.id)!;
  assert.equal(row.need, "needs_budget");
  assert.equal(row.feasibility.travelShortfallMinutes, 0);
});

it("enforces remaining weekly/monthly/daily money with integer accounting", () => {
  const { source, event } = singleEvent("Flight already paid; ground transfer unpaid");
  const settings = { ...settingsFor(source), weeklyLimitMinor: 80000, spentWeeklyMinor: 76000, spentMonthlyMinor: 76000 };
  const plan = planWithJev(source, settings, { gates: { [event.id]: gate }, quotes: [quote(event)], approvals: { [event.id]: "approved" } });
  assert.equal(plan.events[0].status, "unfunded");
  assert.equal(plan.events[0].shortfallMinor, 1000);
  assert.equal(plan.wallet.remainingWeeklyMinor, 4000);
  assert.equal(plan.wallet.plannedMinor, 0);
  const monthly = planWithJev(source, { ...settingsFor(source), spentMonthlyMinor: 199000 }, { quotes: [quote(event)], approvals: { [event.id]: "approved" } });
  assert.equal(monthly.events[0].status, "unfunded");
  assert.equal(monthly.events[0].shortfallMinor, 4000);
  const daily = planWithJev(source, { ...settingsFor(source), dailyLimitMinor: 4000 }, { quotes: [quote(event)], approvals: { [event.id]: "approved" } });
  assert.equal(daily.events[0].shortfallMinor, 1000);
});

it("allocates scarce money by importance, rather than calendar order", () => {
  const { source, event } = singleEvent("Partner dinner");
  event.expenses![0].estimatedAmountMinor = 8000;
  const other = structuredClone(event);
  other.id = "manual:second"; other.title = "Another dinner";
  other.schedule.start = "2026-10-02T18:00:00-04:00"; other.schedule.end = "2026-10-02T19:30:00-04:00";
  other.purpose.importance = "normal";
  source.events.push(other);
  const settings = { ...settingsFor(source), weeklyLimitMinor: 10000 };
  const options = { quotes: [quote(event, 8000, "meal"), quote(other, 8000, "meal")], gates: { [event.id]: gate, [other.id]: gate } };
  let plan = planWithJev(source, settings, options);
  assert.equal(plan.events.find((row) => row.event.id === event.id)?.allocatedMinor, 8000);
  assert.equal(plan.events.find((row) => row.event.id === other.id)?.status, "unfunded");
  event.purpose.importance = "low"; other.purpose.importance = "high";
  plan = planWithJev(source, settings, options);
  assert.equal(plan.events.find((row) => row.event.id === other.id)?.allocatedMinor, 8000);
});

it("aggregates duplicate category lines before clamping and releases rejected funds", () => {
  const { source, event } = singleEvent("Flight already paid; ground transfer unpaid");
  const inflated = { ...quote(event, 12000), lineItems: [{ category: "transport", amountMinor: 6000 }, { category: "transport", amountMinor: 6000 }] };
  let plan = planWithJev(source, settingsFor(source), { quotes: [inflated], approvals: { [event.id]: "approved" } });
  assert.equal(plan.events[0].allocatedMinor, 7500);
  plan = planWithJev(source, settingsFor(source), { quotes: [inflated], approvals: { [event.id]: "rejected" } });
  assert.equal(plan.wallet.plannedMinor, 0);
});

it("shows both mixed-coverage need and actual model contradictions", () => {
  const { source, event } = singleEvent("Workshop; lunch provided, taxi unpaid");
  const plan = planWithJev(source, settingsFor(source), { gates: { [event.id]: gate } });
  assert.equal(plan.events[0].baseline?.needsBudget, false);
  assert.equal(plan.events[0].need, "needs_budget");
  assert.throws(() => validateAllocations({ allocations: [quote(event, 5000, "meal")] }, plan), /covered expense/);
});

it("supplies feedback and actual spending to both contextual history and the LLM input", () => {
  const { source, event } = singleEvent("Partner dinner");
  const history: Assignment[] = [{ id: "past-1", eventId: "past", title: "Partner dinner", createdAt: "2026-09-01T00:00:00Z", currency: "USD", category: "meal", city: event.location.city, importance: "high", durationMinutes: 90, participants: 4, amountMinor: 18000, rationale: "Earlier proposal", source: "gpt-6-luna", feedback: "too_low", actualMinor: 24000 }];
  const plan = planWithJev(source, settingsFor(source), { history });
  const past = allocatorInput(plan).events[0].pastAssignments[0];
  assert.equal(past.feedback, "too_low"); assert.equal(past.actualMinor, 24000);
  assert.throws(() => validateAllocations({ allocations: [{ ...quote(event, 24000, "meal"), historyIds: ["fabricated"] }] }, plan), /history/);
});
