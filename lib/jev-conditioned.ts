import { jevGate } from "./jev";
import { activeEvent, buildContexts } from "./event-context";
import type { EventSnapshot, NormalizedEvent } from "./budget-protocol";
import type { AllocationQuote, Assignment, ConditionedEvent, DemoPlan, DemoSettings, LayaGate } from "./demo-types";
import type { CalendarEvent } from "./types";

// The normalized contract stays v1.0; contextual decisions are presentation
// records around its three gate labels, followed by a separate LLM allocator.
export function defaultSettings(snapshot: EventSnapshot): DemoSettings {
  const weeks = [...new Set([...buildContexts(snapshot).values()].map((context) => context.weekStart))].sort();
  const spentWeeklyMinor = Math.round(Math.min(25000, snapshot.policy.weeklyLimitMinor * .3125));
  const spentMonthlyMinor = Math.max(spentWeeklyMinor, Math.round(Math.min(80000, snapshot.policy.monthlyLimitMinor * .4)));
  return { weekStart: weeks.find((week) => week >= snapshot.window.start.slice(0, 10)) ?? weeks[0] ?? snapshot.window.start.slice(0, 10), weeklyLimitMinor: snapshot.policy.weeklyLimitMinor, dailyLimitMinor: snapshot.policy.dailyLimitMinor, monthlyLimitMinor: snapshot.policy.monthlyLimitMinor, spentWeeklyMinor, spentMonthlyMinor, spentByDate: {}, maxDailyHours: 8, maxWeeklyHours: 40, maxEventHours: 8, maxDifficultyHours: 10 };
}

export function validateSettings(settings: DemoSettings): void {
  for (const key of ["weeklyLimitMinor", "dailyLimitMinor", "monthlyLimitMinor", "spentWeeklyMinor", "spentMonthlyMinor"] as const) {
    if (!Number.isSafeInteger(settings[key]) || settings[key] < 0 || settings[key] > 100000000) throw new Error(`${key} must be a nonnegative integer in minor currency units.`);
  }
  if (settings.spentWeeklyMinor > settings.spentMonthlyMinor) throw new Error("Monthly spending must include this week's spending.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(settings.weekStart)) throw new Error("Choose a valid week.");
  for (const key of ["maxDailyHours", "maxWeeklyHours", "maxEventHours", "maxDifficultyHours"] as const) {
    if (!Number.isFinite(settings[key]) || settings[key] < 0.5 || settings[key] > 168) throw new Error(`${key} must be between 0.5 and 168 hours.`);
  }
  if (!settings.spentByDate || typeof settings.spentByDate !== "object" || Array.isArray(settings.spentByDate)) throw new Error("Daily spending must be a date-to-amount map.");
  for (const [date, amount] of Object.entries(settings.spentByDate)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isSafeInteger(amount) || amount < 0) throw new Error("Daily spending needs valid dates and nonnegative minor amounts.");
  }
}

function project(event: NormalizedEvent): CalendarEvent | null {
  const { totalCount, externalCount } = event.participants;
  if (totalCount === null || externalCount === null) return null;
  return { id: event.id, title: event.title, description: event.description ?? "", location: event.location.mode === "virtual" ? "Virtual" : event.location.label ?? "", start: event.schedule.start, end: event.schedule.end, city: event.location.city ?? "", attendees: Array.from({ length: totalCount }, (_, i) => ({ name: "Participant", email: `person${i}@${i < externalCount ? "guest.example" : "work.example"}` })) };
}

function estimate(category: string, event: NormalizedEvent, durationMinutes: number): number {
  const people = event.participants.totalCount ?? 1;
  if (category === "transport") return Math.round(Math.max(1500, (event.location.travelFromPreviousMinutes ?? 35) * 80));
  if (category === "meal") return 4500 * people;
  if (category === "coffee") return 1200 * people;
  if (category === "lodging") return 15000 * Math.max(1, Math.ceil(durationMinutes / 1440));
  return 3000;
}

export function relevantHistory(event: NormalizedEvent, history: Assignment[]): Assignment[] {
  const categories = new Set<string>(event.expenses?.map((line) => line.category) ?? []);
  return history.filter((entry) => entry.currency !== "" && (categories.has(entry.category) || entry.title === event.title)).map((entry) => ({ entry, score: (entry.title === event.title ? 8 : 0) + (entry.city === event.location.city ? 3 : 0) + (entry.importance === event.purpose.importance ? 2 : 0) + (entry.participants === event.participants.totalCount ? 2 : 0) + (entry.actualMinor !== null ? 6 : entry.feedback ? 3 : 0) })).sort((a, b) => b.score - a.score || b.entry.createdAt.localeCompare(a.entry.createdAt)).slice(0, 5).map(({ entry }) => entry);
}

export function planWithJev(snapshot: EventSnapshot, settings: DemoSettings, options: { quotes?: AllocationQuote[]; history?: Assignment[]; approvals?: Record<string, "approved" | "rejected">; gates?: Record<string, LayaGate> } = {}): DemoPlan {
  validateSettings(settings);
  const contexts = buildContexts(snapshot);
  const weeks = [...new Set([...contexts.values()].map((context) => context.weekStart))].sort();
  if (!weeks.includes(settings.weekStart) && snapshot.events.length) throw new Error("That week is outside the supplied calendar.");
  const history = options.history ?? [];
  const quotes = new Map(options.quotes?.map((quote) => [quote.eventId, quote]));
  const availableWeeklyMinor = Math.max(0, settings.weeklyLimitMinor - settings.spentWeeklyMinor);
  const availableMonthlyMinor = Math.max(0, settings.monthlyLimitMinor - settings.spentMonthlyMinor);
  const availableForDay = (date: string) => Math.max(0, settings.dailyLimitMinor - (settings.spentByDate[date] ?? 0));
  const rows: ConditionedEvent[] = snapshot.events.filter((event) => contexts.get(event.id)?.weekStart === settings.weekStart).map((event): ConditionedEvent => {
    const context = contexts.get(event.id)!;
    const projected = project(event);
    const baseline = projected ? jevGate(projected, { companyDomain: "work.example", timeZone: event.schedule.timeZone }) : null;
    const conflicts = snapshot.events.filter((other) => other.id !== event.id && activeEvent(other) && !other.schedule.allDay && !event.schedule.allDay && Date.parse(other.schedule.start) < Date.parse(event.schedule.end) && Date.parse(other.schedule.end) > Date.parse(event.schedule.start)).map((other) => other.id);
    const travelShortfallMinutes = context.transition.gapMinutes !== null && context.transition.travelMinutes !== null && event.location.mode !== "virtual" ? Math.max(0, context.transition.travelMinutes - context.transition.gapMinutes) : 0;
    const difficultyFactor = event.purpose.difficulty === "high" ? 1.5 : event.purpose.difficulty === "moderate" ? 1.25 : 1;
    const effortHours = context.durationMinutes / 60 * difficultyFactor;
    const infeasible = conflicts.length > 0 || travelShortfallMinutes > 0 || (!event.schedule.allDay && context.durationMinutes / 60 > settings.maxEventHours) || (!event.schedule.allDay && effortHours > settings.maxDifficultyHours);
    const overloaded = context.day.busyMinutes / 60 > settings.maxDailyHours || context.week.busyMinutes / 60 > settings.maxWeeklyHours;
    const unpaid = event.expenses?.filter((line) => line.coverage === "not_covered" && line.estimatedAmountMinor !== 0) ?? [];
    let need: ConditionedEvent["need"] = "needs_budget", reason = "Confirmed uncovered work expense.";
    if (!activeEvent(event) || event.purpose.scope === "personal") {
      need = "no_budget"; reason = !activeEvent(event) ? "Cancelled or declined; no funding." : "Personal event; no company funding.";
    } else if (event.expenses !== null && event.expenses.every((line) => line.coverage === "provided" || line.coverage === "prepaid" || (line.coverage === "not_covered" && line.estimatedAmountMinor === 0))) {
      need = "no_budget"; reason = "No expected cost, or every expense is covered.";
    } else if (event.purpose.scope === "unknown" || event.attendance !== "accepted" || event.status !== "confirmed" || event.expenses === null || event.expenses.some((line) => line.coverage === "unknown") || unpaid.some((line) => line.estimatedAmountMinor === null) || event.purpose.importance === "unknown" || event.purpose.difficulty === "unknown") {
      need = "needs_review"; reason = "Unconfirmed expense, purpose, attendance, or event facts; ask the allocator to resolve the uncertainty.";
    }
    if (need !== "no_budget" && infeasible) { need = "needs_review"; reason = conflicts.length ? "Overlapping commitments make attendance dubious." : travelShortfallMinutes > 0 ? `Travel needs ${Math.ceil(travelShortfallMinutes)} more minutes than the calendar allows.` : "Duration or difficulty exceeds your event capacity."; }
    if (need !== "no_budget" && overloaded && !infeasible && event.purpose.importance !== "high") { need = "needs_review"; reason = "Calendar load exceeds your capacity; this event needs a feasibility check."; }
    const classifier = options.gates?.[event.id] ? { ...options.gates[event.id] } : null;
    if (classifier) {
      if (need === "no_budget") classifier.override = "Confirmed no-spend facts are enforced in code.";
      else if (need === "needs_review") classifier.override = reason;
      else if (classifier.truncated || classifier.confidence < 0.55) { need = "needs_review"; reason = classifier.truncated ? "Laya input was truncated; funding is dubious." : "Laya is uncertain about the funding need."; classifier.override = reason; }
      else if (classifier.rawLabel === "no_budget" && unpaid.length) { need = "needs_review"; reason = "Laya's no-funding prediction conflicts with a recorded unpaid expense; review it."; classifier.override = reason; }
      else { need = classifier.rawLabel; reason = need === "needs_budget" ? "Laya classified this as definitely needing funding from the event, wallet, schedule, and prior patterns." : "Laya classified the funding need as dubious."; }
    }
    const guessedCategory = baseline?.category === "transport" ? "transport" : baseline?.category === "client_coffee" ? "coffee" : "meal";
    const costs = unpaid.length ? unpaid.map((line) => ({ category: line.category, amount: line.estimatedAmountMinor ?? estimate(line.category, event, context.durationMinutes) })) : need !== "no_budget" ? [{ category: guessedCategory, amount: estimate(guessedCategory, event, context.durationMinutes) }] : [];
    const byCategory = new Map<string, number>();
    for (const line of costs) byCategory.set(line.category, (byCategory.get(line.category) ?? 0) + line.amount);
    const lineItems = [...byCategory].map(([category, amount]) => ({ category, requestedMinor: amount, cappedMinor: Math.min(amount, snapshot.policy.categoryCapsMinor[category as keyof typeof snapshot.policy.categoryCapsMinor]) }));
    const priority = (event.purpose.importance === "high" ? 100 : event.purpose.importance === "normal" ? 60 : 20) + (event.participants.externalCount ? 10 : 0) + (event.purpose.difficulty === "high" ? 5 : 0) - Math.min(20, context.durationMinutes / 60 * 3) - Math.min(10, context.day.busyMinutes / 60) - Math.min(10, context.week.busyMinutes / 60 / 4);
    const requestedMinor = lineItems.reduce((sum, line) => sum + line.requestedMinor, 0);
    const cappedMinor = lineItems.reduce((sum, line) => sum + line.cappedMinor, 0);
    const money = (amount: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: snapshot.policy.currency }).format(amount / 100);
    const conditions: ConditionedEvent["conditions"] = [
      { name: "Purpose & attendance", value: `${event.purpose.scope} · ${event.status} · ${event.attendance}`, effect: need === "no_budget" ? "negative" : "neutral" },
      { name: "Expense coverage", value: event.expenses === null ? "Unknown" : event.expenses.length ? event.expenses.map((line) => `${line.category}: ${line.coverage.replaceAll("_", " ")}`).join("; ") : "No expected expense", effect: unpaid.length ? "positive" : "neutral" },
      { name: "Importance", value: event.purpose.importance, effect: event.purpose.importance === "high" ? "positive" : "neutral" },
      { name: "Duration & difficulty", value: `${Math.round(context.durationMinutes)} min · ${event.purpose.difficulty} · ${effortHours.toFixed(1)} effort hours`, effect: effortHours > settings.maxDifficultyHours ? "negative" : "neutral" },
      { name: "Calendar load", value: `${(context.day.busyMinutes / 60).toFixed(1)}h today / ${(context.week.busyMinutes / 60).toFixed(1)}h this week${context.week.complete ? "" : " (partial week)"}`, effect: overloaded ? "negative" : "neutral" },
      { name: "Travel & conflicts", value: conflicts.length ? `${conflicts.length} overlap(s)` : travelShortfallMinutes ? `${Math.ceil(travelShortfallMinutes)} min travel shortfall` : context.transition.travelMinutes === null ? "Travel estimate unknown" : "Schedule is feasible", effect: infeasible ? "negative" : "positive" },
      { name: "Participants & place", value: `${event.participants.totalCount ?? "Unknown"} total · ${event.participants.externalCount ?? "Unknown"} external · ${event.location.city ?? "unknown city"} · ${event.location.mode.replaceAll("_", " ")}`, effect: event.participants.externalCount ? "positive" : "neutral" },
      { name: "Money available", value: `${money(availableForDay(context.date))} daily · ${money(availableWeeklyMinor)} weekly · ${money(availableMonthlyMinor)} monthly`, effect: Math.min(availableForDay(context.date), availableWeeklyMinor, availableMonthlyMinor) < cappedMinor ? "negative" : "neutral" },
      { name: "Category cap", value: `${money(cappedMinor)} maximum across ${lineItems.map((line) => line.category).join(", ") || "no expenses"}`, effect: cappedMinor < requestedMinor ? "negative" : "neutral" },
    ];
    return { event, context, baseline, need, status: need === "no_budget" ? "no_budget" : "review", reason, conditions, feasibility: { feasible: !infeasible, conflicts, travelShortfallMinutes, effortHours }, priority, requestedMinor, proposedMinor: 0, allocatedMinor: 0, shortfallMinor: 0, remainingBefore: { dailyMinor: availableForDay(context.date), weeklyMinor: availableWeeklyMinor, monthlyMinor: availableMonthlyMinor }, lineItems, allocation: null, history: relevantHistory(event, history.filter((entry) => entry.currency === snapshot.policy.currency)), classifier };
  });
  let weekly = availableWeeklyMinor, monthly = availableMonthlyMinor;
  const daily = new Map<string, number>();
  const sorted = [...rows].sort((a, b) => (options.approvals?.[b.event.id] === "approved" ? 1000 : 0) - (options.approvals?.[a.event.id] === "approved" ? 1000 : 0) || b.priority - a.priority || a.event.schedule.start.localeCompare(b.event.schedule.start) || a.event.id.localeCompare(b.event.id));
  for (const row of sorted) {
    const dayRemaining = daily.get(row.context.date) ?? availableForDay(row.context.date);
    row.remainingBefore = { dailyMinor: dayRemaining, weeklyMinor: weekly, monthlyMinor: monthly };
    const moneyCondition = row.conditions.find((condition) => condition.name === "Money available")!;
    const format = (amount: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: snapshot.policy.currency }).format(amount / 100);
    moneyCondition.value = `${format(dayRemaining)} daily · ${format(weekly)} weekly · ${format(monthly)} monthly before this assignment`;
    if (row.need === "no_budget") continue;
    const quote = quotes.get(row.event.id);
    if (!quote) { row.reason += " Run the LLM allocator for an amount and rationale."; continue; }
    row.allocation = quote;
    // Category aggregation prevents evading a cap with duplicate line items.
    const totals = new Map<string, number>();
    for (const line of quote.lineItems) totals.set(line.category, (totals.get(line.category) ?? 0) + line.amountMinor);
    let capped = 0;
    for (const [category, amount] of totals) capped += Math.min(amount, snapshot.policy.categoryCapsMinor[category as keyof typeof snapshot.policy.categoryCapsMinor] ?? 0);
    row.proposedMinor = Math.min(quote.amountMinor, capped);
    if (options.approvals?.[row.event.id] === "rejected") { row.status = "rejected"; row.reason = "You rejected this assignment; its funds are released."; continue; }
    if (row.proposedMinor === 0) { row.status = row.need === "needs_review" ? "review" : "unfunded"; row.reason = quote.rationale; continue; }
    if (row.need === "needs_review" && options.approvals?.[row.event.id] !== "approved") { row.status = "review"; row.reason = `${quote.rationale} ${row.reason}`; continue; }
    const available = Math.min(dayRemaining, weekly, monthly);
    if (row.proposedMinor > available) { row.status = "unfunded"; row.shortfallMinor = row.proposedMinor - available; row.reason = `The proposed amount exceeds remaining ${dayRemaining === available ? "daily" : weekly === available ? "weekly" : "monthly"} funds. ${quote.rationale}`; continue; }
    row.allocatedMinor = row.proposedMinor;
    row.status = options.approvals?.[row.event.id] === "approved" ? "approved" : "ready";
    row.reason = quote.rationale;
    if (quote.amountMinor > capped) row.reason += " Amount clamped to category caps.";
    weekly -= row.allocatedMinor; monthly -= row.allocatedMinor;
    daily.set(row.context.date, dayRemaining - row.allocatedMinor);
  }
  const summary: DemoPlan["summary"] = { ready: 0, review: 0, no_budget: 0, unfunded: 0, approved: 0, rejected: 0 };
  for (const row of rows) summary[row.status]++;
  return { snapshot, settings, weeks, events: rows.sort((a, b) => a.event.schedule.start.localeCompare(b.event.schedule.start)), wallet: { availableWeeklyMinor, availableMonthlyMinor, plannedMinor: availableWeeklyMinor - weekly, approvedMinor: rows.filter((row) => row.status === "approved").reduce((sum, row) => sum + row.allocatedMinor, 0), remainingWeeklyMinor: weekly, remainingMonthlyMinor: monthly }, summary, pricing: { state: options.quotes ? "complete" : "not_run", model: "gpt-6-luna", elapsedMs: 0, calledEvents: options.quotes?.length ?? 0, historyCount: history.length, newAssignments: 0 }, history: history.slice(-15).reverse(), gateModel: { backend: "laya", elapsedMs: 0, calledEvents: options.gates ? rows.length : 0 } };
}
