import { toCents } from "./money";
import { policy } from "./policy";
import { addMinutes, formatTime, parseInstant } from "./time";
import type { ChargeAttempt, PricedEvent } from "./types";

export type BudgetTab = "overview" | "review" | "live" | "none";
export type EventFilters = {
  query: string;
  category?: string;
  lowConfidenceOnly?: boolean;
};

/** These are presentation groups, not proof of a real Ramp card or current authorization. */
export function eventStatus(item: PricedEvent): Exclude<BudgetTab, "overview"> {
  if (item.archived || !item.jev.needsBudget || !item.budget || item.approval === "rejected") return "none";
  return item.approval === "approved" && item.limit ? "live" : "review";
}

export function eventCounts(events: PricedEvent[]): Record<BudgetTab, number> {
  const counts: Record<BudgetTab, number> = { overview: events.length, review: 0, live: 0, none: 0 };
  for (const item of events) counts[eventStatus(item)] += 1;
  return counts;
}

export function filterEvents(events: PricedEvent[], tab: BudgetTab, filters: EventFilters): PricedEvent[] {
  const query = filters.query.trim().toLocaleLowerCase("en-US");
  const category = filters.category?.trim();
  return events.filter((item) => {
    if (tab !== "overview" && eventStatus(item) !== tab) return false;
    if (category && category !== "all" && (item.budget?.category ?? item.jev.category) !== category) return false;
    if (filters.lowConfidenceOnly && item.jev.confidence !== "low") return false;
    if (!query) return true;
    const searchable = [item.event.title, item.event.description, item.event.location, item.event.city,
      ...item.event.attendees.flatMap((attendee) => [attendee.name, attendee.email])].join("\n");
    return searchable.toLocaleLowerCase("en-US").includes(query);
  });
}

export type PipelineGate = "no_budget" | "needs_budget" | "needs_review";

/** Groups events into the funding pipeline's three bins. */
export function pipelineGate(item: PricedEvent): PipelineGate {
  if (item.archived || !item.jev.needsBudget || !item.budget) return "no_budget";
  if (item.jev.confidence === "low" || item.budget.clamped) return "needs_review";
  if (item.jev.category === "default_per_diem" || item.jev.rule === "classifier" || item.jev.rule === "vague_title") {
    return "needs_review";
  }
  if (!item.event.location.trim()) return "needs_review";
  return "needs_budget";
}

/** Charges are matched by stable event identity; never by a coincidentally equal title. */
export function latestChargeFor(eventId: string, charges: ChargeAttempt[]): ChargeAttempt | undefined {
  let latest: ChargeAttempt | undefined;
  let latestTime = -Infinity;
  for (const charge of charges) {
    if (charge.eventId !== eventId) continue;
    const time = parseInstant(charge.time);
    if (time !== null && time >= latestTime) { latest = charge; latestTime = time; }
  }
  return latest;
}

/** Preview the same policy window as createLimit without importing server-only authorization code. */
export function eventWindow(item: PricedEvent): string {
  if (item.archived || !item.budget || item.approval === "rejected") return "—";
  const start = parseInstant(item.event.start);
  const end = parseInstant(item.event.end);
  if (start === null || end === null || start >= end || toCents(item.budget.amount) === null) return "—";
  const transport = item.budget.category === "transport";
  const before = transport ? policy.windows.transportMinutesBefore : policy.windows.mealMinutesBefore;
  const after = transport ? policy.windows.transportMinutesAfter : policy.windows.mealMinutesAfter;
  return `${formatTime(addMinutes(item.event.start, -before))}–${formatTime(addMinutes(item.event.end, after))}`;
}

const INITIAL_PALETTE = ["indigo", "teal", "amber", "pink", "violet"];
function initials(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  return `${words[0][0]}${words.length > 1 ? words[words.length - 1][0] : words[0][1] ?? ""}`.toLowerCase();
}
function palette(identity: string): string {
  let hash = 0;
  for (let index = 0; index < identity.length; index++) hash = (hash * 31 + identity.charCodeAt(index)) >>> 0;
  return INITIAL_PALETTE[hash % INITIAL_PALETTE.length];
}

export function avatarFor(item: PricedEvent): { className: string; label: string } {
  const text = `${item.event.title} ${item.event.location}`;
  if (/\bacme\b/i.test(text)) return { className: "sg", label: "ac" };
  if (/\bstand[ -]?up\b|\bzoom\b/i.test(text)) return { className: "zoom", label: "zoom" };
  if ((item.budget?.category ?? item.jev.category) === "transport" || /\bflight\b|\buber\b|\blyft\b|\btaxi\b/i.test(text)) return { className: "delta", label: "" };
  if (/\bsolo lunch\b/i.test(item.event.title) || (/\blunch\b/i.test(item.event.title) && item.event.attendees.length <= 1 && item.budget?.category === "meal")) return { className: "amazon", label: "" };
  const jordan = item.event.attendees.find((attendee) => /^jordan\b/i.test(attendee.name));
  const person = jordan ?? (item.event.attendees.length === 1 ? item.event.attendees[0] : undefined);
  const label = jordan || /\bjordan\b/i.test(item.event.title) ? "jd" : initials(person?.name ?? item.event.title);
  return { className: palette(item.event.id), label };
}
