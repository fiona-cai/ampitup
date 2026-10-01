import { policy } from "./policy";
import { addMinutes, formatMoney, formatTime } from "./time";
import type { ChargeAttempt, PricedEvent, SpendCategory, SpendLimit } from "./types";

function isTransport(category: SpendCategory): boolean {
  return category === "transport";
}

export function createLimit(event: PricedEvent, previous?: SpendLimit | null): SpendLimit | null {
  if (!event.budget) return null;
  const category = event.budget.category;
  const before = isTransport(category)
    ? policy.windows.transportMinutesBefore
    : policy.windows.mealMinutesBefore;
  const after = isTransport(category)
    ? policy.windows.transportMinutesAfter
    : policy.windows.mealMinutesAfter;

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
    if (!event.budget || event.approval === "rejected") return event;
    return {
      ...event,
      approval: "approved",
      limit: createLimit(event, event.limit),
    };
  });
}

function duration(event: PricedEvent): number {
  if (!event.limit) return Number.POSITIVE_INFINITY;
  return new Date(event.limit.activeUntil).getTime() - new Date(event.limit.activeFrom).getTime();
}

export function authorize(
  events: PricedEvent[],
  input: { amount: number; time: string; merchant: string },
): { events: PricedEvent[]; charge: ChargeAttempt } {
  const when = new Date(input.time).getTime();
  const open = events.filter((event) => {
    if (event.approval !== "approved" || !event.limit) return false;
    const from = new Date(event.limit.activeFrom).getTime();
    const until = new Date(event.limit.activeUntil).getTime();
    return when >= from && when <= until;
  });

  const id = `chg_${Date.now().toString(36)}_${Math.round(input.amount)}`;

  if (open.length === 0) {
    return {
      events,
      charge: {
        id,
        merchant: input.merchant,
        amount: input.amount,
        time: input.time,
        result: "declined",
        eventId: null,
        eventTitle: null,
        detail: `Declined. No budget is open at ${formatTime(input.time)}. Limits don't cover the gaps between events.`,
        report: null,
      },
    };
  }

  open.sort((a, b) => duration(a) - duration(b));
  const match = open[0];
  const limit = match.limit;
  if (!limit) {
    return {
      events,
      charge: {
        id,
        merchant: input.merchant,
        amount: input.amount,
        time: input.time,
        result: "declined",
        eventId: match.event.id,
        eventTitle: match.event.title,
        detail: "Declined. This event has no open limit.",
        report: null,
      },
    };
  }

  const remaining = limit.amount - limit.spent;
  if (input.amount > remaining) {
    const other = events
      .filter((event) => event.approval === "approved" && event.limit && event.event.id !== match.event.id)
      .sort((a, b) => (b.limit?.amount ?? 0) - (a.limit?.amount ?? 0))[0];
    const borrow = other
      ? ` This card can't borrow from ${other.event.title}.`
      : " This card can't borrow from another event.";
    return {
      events,
      charge: {
        id,
        merchant: input.merchant,
        amount: input.amount,
        time: input.time,
        result: "declined",
        eventId: match.event.id,
        eventTitle: match.event.title,
        detail: `Declined. ${match.event.title} is capped at ${formatMoney(limit.amount)}.${borrow}`,
        report: null,
      },
    };
  }

  const nextEvents = events.map((event) => {
    if (event.event.id !== match.event.id || !event.limit) return event;
    return { ...event, limit: { ...event.limit, spent: event.limit.spent + input.amount } };
  });
  const left = remaining - input.amount;

  return {
    events: nextEvents,
    charge: {
      id,
      merchant: input.merchant,
      amount: input.amount,
      time: input.time,
      result: "approved",
      eventId: match.event.id,
      eventTitle: match.event.title,
      detail: `Approved. ${formatMoney(input.amount)} at ${input.merchant} matched to ${match.event.title}. ${formatMoney(left)} left on this limit.`,
      report: `${input.merchant} · ${match.event.title} · receipt matched to the calendar event`,
    },
  };
}
