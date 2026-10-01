import { jevGate } from "./jev";
import { policy } from "./policy";
import { priceEvent } from "./price";
import type { CalendarEvent, PricedEvent } from "./types";

export async function priceEvents(
  events: CalendarEvent[],
  companyDomain = policy.companyDomain,
): Promise<PricedEvent[]> {
  return Promise.all(
    events.map(async (event) => {
      const jev = jevGate(event, { companyDomain });
      const budget = jev.needsBudget ? await priceEvent(event, jev, companyDomain) : null;
      return {
        event,
        jev,
        budget,
        approval: "pending" as const,
        limit: null,
      };
    }),
  );
}

export function pricerLabel(events: PricedEvent[]): "claude" | "policy" | "mixed" | null {
  const sources = new Set(events.flatMap((event) => (event.budget ? [event.budget.source] : [])));
  if (sources.size === 0) return "policy";
  if (sources.size > 1) return "mixed";
  return sources.has("claude") ? "claude" : "policy";
}
