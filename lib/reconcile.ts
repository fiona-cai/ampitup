import { createLimit } from "./ramp";
import type { CalendarEvent, PricedEvent } from "./types";

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, canonical(entry)]));
  }
  return value;
}

function fingerprint(item: PricedEvent): string {
  const event = {
    ...item.event,
    attendees: [...item.event.attendees].sort((a, b) =>
      a.email.localeCompare(b.email) || a.name.localeCompare(b.name)),
  };
  return JSON.stringify(canonical({ event, jev: item.jev, budget: item.budget }));
}

function cancelled(event: CalendarEvent): boolean {
  const status = (event as CalendarEvent & { status?: string }).status;
  return status === "cancelled" || status === "canceled";
}

/** Source refreshes can revoke approval, but must never replenish spent money. */
export function reconcileEvents(previous: PricedEvent[], incoming: PricedEvent[]): PricedEvent[] {
  const previousById = new Map(previous.map((item) => [item.event.id, item]));
  const seen = new Set<string>();
  const reconciled = incoming.map((item): PricedEvent => {
    if (!item.event.id || seen.has(item.event.id)) throw new TypeError("Source events need unique, stable identities.");
    seen.add(item.event.id);
    const old = previousById.get(item.event.id);
    const archived = item.archived === true || cancelled(item.event);
    if (!old) return { ...item, archived, approval: archived ? "rejected" : "pending", limit: null };
    const changed = old.archived === true || fingerprint(old) !== fingerprint(item);
    const active = { ...item, archived: false };
    return {
      ...item,
      archived,
      approval: archived ? "rejected" : changed ? "pending" : old.approval,
      // Keep the old ledger even if the new source no longer needs a budget.
      limit: !archived && item.budget ? createLimit(active, old.limit) ?? old.limit : old.limit,
    };
  });
  for (const old of previous) {
    if (!seen.has(old.event.id)) reconciled.push({ ...old, archived: true, approval: "rejected" });
  }
  return reconciled;
}
