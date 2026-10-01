import { randomUUID } from "node:crypto";
import { fromCents, toCents } from "./money";
import { policy } from "./policy";
import { addMinutes, formatMoney, formatTime, parseInstant } from "./time";
import type { ChargeAttempt, PricedEvent, SpendCategory, SpendLimit } from "./types";

function isTransport(category: SpendCategory): boolean {
  return category === "transport";
}

export function createLimit(event: PricedEvent, previous?: SpendLimit | null): SpendLimit | null {
  // An archived record may retain its old ledger, but never creates a new limit.
  if (event.archived) return previous ?? null;
  if (!event.budget) return previous ?? null;
  const start = parseInstant(event.event.start);
  const end = parseInstant(event.event.end);
  if (start === null || end === null || start >= end || toCents(event.budget.amount) === null) return null;
  const before = isTransport(event.budget.category)
    ? policy.windows.transportMinutesBefore : policy.windows.mealMinutesBefore;
  const after = isTransport(event.budget.category)
    ? policy.windows.transportMinutesAfter : policy.windows.mealMinutesAfter;
  return {
    id: previous?.id ?? `limit_${event.event.id}`,
    eventId: event.event.id,
    amount: event.budget.amount,
    currency: "USD",
    activeFrom: addMinutes(event.event.start, -before),
    activeUntil: addMinutes(event.event.end, after),
    spent: previous?.spent ?? 0,
  };
}

export function approveBudgeted(events: PricedEvent[]): PricedEvent[] {
  return events.map((event) => {
    if (event.archived) return { ...event, approval: "rejected" };
    if (!event.budget || event.approval === "rejected") return event;
    return { ...event, approval: "approved", limit: createLimit(event, event.limit) };
  });
}

export type ChargeInput = {
  amount: number;
  time: string;
  merchant: string;
  eventId?: string;
  requestId?: string;
};

export function authorize(
  events: PricedEvent[],
  input: ChargeInput,
): { events: PricedEvent[]; charge: ChargeAttempt } {
  const amountCents = toCents(input.amount);
  if (amountCents === null || amountCents <= 0 || amountCents > 1_000_000) {
    throw new TypeError("Enter a positive charge up to $10,000 using at most two decimal places.");
  }
  const when = parseInstant(input.time);
  if (when === null) throw new TypeError("Charge time must be a valid ISO timestamp with an explicit timezone offset.");
  if (input.eventId !== undefined && (typeof input.eventId !== "string" || !input.eventId.trim() || input.eventId.length > 200)) {
    throw new TypeError("That event identity is not valid.");
  }
  if (input.requestId !== undefined && (typeof input.requestId !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(input.requestId))) {
    throw new TypeError("That charge request identity is not valid.");
  }
  const merchant = typeof input.merchant === "string" && input.merchant.trim()
    ? input.merchant.trim().slice(0, 80) : "Card swipe";
  const id = `chg_${randomUUID()}`;
  const decline = (detail: string, match?: PricedEvent): { events: PricedEvent[]; charge: ChargeAttempt } => ({
    events,
    charge: {
      id,
      ...(input.requestId ? { requestId: input.requestId } : {}),
      merchant,
      amount: fromCents(amountCents),
      time: input.time,
      result: "declined",
      eventId: match?.event.id ?? null,
      eventTitle: match?.event.title ?? null,
      detail,
      report: null,
    },
  });
  const open = events.filter((event) => {
    if (event.archived || event.approval !== "approved" || !event.budget || !event.limit) return false;
    if (input.eventId !== undefined && event.event.id !== input.eventId) return false;
    const from = parseInstant(event.limit.activeFrom);
    const until = parseInstant(event.limit.activeUntil);
    return from !== null && until !== null && when >= from && when < until;
  });
  if (open.length === 0) {
    const bound = input.eventId ? events.find((event) => event.event.id === input.eventId) : undefined;
    return decline(input.eventId
      ? `Declined. The selected event budget is not open at ${formatTime(input.time)}. No other event budget was used.`
      : `Declined. No budget is open at ${formatTime(input.time)}. Limits don't cover the gaps between events.`, bound);
  }
  if (open.length !== 1) {
    return decline("Declined. Multiple event budgets are open. Bind this charge to one event; budgets cannot be pooled or guessed.");
  }
  const match = open[0];
  const limit = match.limit!;
  const limitCents = toCents(limit.amount);
  const spentCents = toCents(limit.spent);
  if (limitCents === null || spentCents === null || limit.eventId !== match.event.id) {
    return decline("Declined. This event's spending ledger needs manager review.", match);
  }
  const remainingCents = limitCents - spentCents;
  if (amountCents > remainingCents) {
    const other = events.filter((event) => event.approval === "approved" && event.limit && event.event.id !== match.event.id)
      .sort((a, b) => (b.limit?.amount ?? 0) - (a.limit?.amount ?? 0))[0];
    const borrow = other ? ` This card can't borrow from ${other.event.title}.` : " This card can't borrow from another event.";
    return decline(`Declined. ${match.event.title} is capped at ${formatMoney(limit.amount)}.${borrow}`, match);
  }
  const nextEvents = events.map((event) => event.event.id === match.event.id && event.limit
    ? { ...event, limit: { ...event.limit, spent: fromCents(spentCents + amountCents) } } : event);
  const left = fromCents(remainingCents - amountCents);
  return {
    events: nextEvents,
    charge: {
      id,
      ...(input.requestId ? { requestId: input.requestId } : {}),
      merchant,
      amount: fromCents(amountCents),
      time: input.time,
      result: "approved",
      eventId: match.event.id,
      eventTitle: match.event.title,
      detail: `Approved. ${formatMoney(input.amount)} at ${merchant} matched to ${match.event.title}. ${formatMoney(left)} left on this limit.`,
      report: `${merchant} · ${match.event.title} · simulated expense matched to the calendar event`,
    },
  };
}
