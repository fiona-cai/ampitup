import { externalAttendees } from "./attendees";
import { mealSlot } from "./time";
import type { CalendarEvent, JevDecision, SpendCategory } from "./types";

/**
 * Jev decides whether an event needs company money. It does not pick the amount.
 *
 * Clear cases are rules and return immediately: already paid, focus time,
 * internal meetings without a venue, transport, and meals that name a place.
 * Whatever is left is scored. External people, a meal-time start, and a real
 * place push toward a budget. Anything inferred, vague, or missing a place
 * stays low confidence so a person can review it.
 */

const ALREADY_PAID =
  /meal[s]? included|lunch provided|breakfast provided|dinner provided|catered|registration includes|prepaid|already booked/i;
const FOCUS = /\b(focus|deep work|heads down|out of office|ooo|blocked)\b/i;
const INTERNAL_MEETING =
  /\b(standup|stand-up|retro|retrospective|1:1|1-1|one-on-one|sync|planning|all-hands|all hands|sprint review)\b/i;
const TRANSPORT = /\b(uber|lyft|taxi|cab|rideshare|ride share)\b/i;
const MEAL = /\b(breakfast|brunch|lunch|dinner|supper|coffee|tea|drinks)\b/i;
const GENERIC_MEAL = /^(solo |team )?(breakfast|brunch|lunch|dinner|supper|coffee|tea|drinks)$/i;
const VAGUE =
  /\b(catch[\s-]?up|chat|connect|tbd|follow[\s-]?up|check[\s-]?in|intro|hangout|hang out|meetup|meet[\s-]?up|social|networking|offsite|onsite|visit|walk|office hours|quick|informal)\b/i;
const VIRTUAL = /zoom|google meet|meet\.google|teams|virtual|remote|phone/i;
const OFFICE = /\b(office|hq|headquarters|\broom\b|conference room|floor|building)\b/i;

export const RULE_LABELS: Record<string, string> = {
  already_paid: "Already paid",
  focus_block: "Focus block",
  internal_meeting: "Internal meeting",
  transport: "Transport",
  client_meal: "Client meal",
  client_coffee: "Client coffee",
  solo_meal: "Solo meal",
  team_meal: "Team meal",
  vague_title: "Vague title",
  classifier: "Classifier",
  no_spend: "No spend",
};

function blob(event: CalendarEvent): string {
  return `${event.title} ${event.description} ${event.location}`;
}

function hasPlace(event: CalendarEvent): boolean {
  const location = event.location.trim();
  if (!location) return false;
  return !VIRTUAL.test(location);
}

function hasVenue(event: CalendarEvent): boolean {
  return hasPlace(event) && !OFFICE.test(event.location);
}

function mealUnclear(event: CalendarEvent, text: string): string[] {
  const flags: string[] = [];
  if (!hasPlace(event)) flags.push("no place");
  if (GENERIC_MEAL.test(event.title.trim())) flags.push("generic title");
  if (event.attendees.length === 0) flags.push("no attendees");
  if (VAGUE.test(text)) flags.push("vague title");
  return flags;
}

function decide(
  needsBudget: boolean,
  reason: string,
  confidence: "high" | "low",
  category: SpendCategory | null,
  rule: string,
  signals: string[],
): JevDecision {
  return { needsBudget, reason, confidence, category, rule, signals };
}

function alreadyPaidReason(text: string): string {
  if (/catered/i.test(text)) return "Catered, no spend expected";
  if (/included|provided/i.test(text)) return "Meal included in registration";
  return "Already paid, no spend expected";
}

export function jevGate(
  event: CalendarEvent,
  options: { companyDomain?: string; timeZone?: string } = {},
): JevDecision {
  const text = blob(event);
  const external = externalAttendees(event, options.companyDomain);
  const signals: string[] = [];

  if (ALREADY_PAID.test(text)) {
    return decide(false, alreadyPaidReason(text), "high", null, "already_paid", [
      "Event says the company or the host already covered it",
    ]);
  }

  if (external.length === 0 && FOCUS.test(text)) {
    return decide(false, "Focus block, no spend expected", "high", null, "focus_block", [
      "Focus time with no outside guests",
    ]);
  }

  if (external.length === 0 && INTERNAL_MEETING.test(text) && !hasVenue(event)) {
    return decide(false, "Internal, no spend expected", "high", null, "internal_meeting", [
      "Internal meeting",
    ]);
  }

  if (TRANSPORT.test(text)) {
    return decide(true, "Travel needs a budget", "high", "transport", "transport", [
      "Ride or transfer",
    ]);
  }

  if (MEAL.test(text)) {
    const coffeeOnly =
      /\b(coffee|tea)\b/i.test(text) && !/\b(breakfast|brunch|lunch|dinner|supper|drinks)\b/i.test(text);
    const unclear = mealUnclear(event, text);
    const confidence = unclear.length ? "low" : "high";
    if (external.length > 0) {
      return decide(
        true,
        coffeeOnly
          ? unclear.length
            ? "Coffee with a guest, but the details are thin"
            : "Coffee with a guest needs a budget"
          : unclear.length
            ? "Looks like a client meal, but the details are thin"
            : "Client meal, a budget is expected",
        confidence,
        coffeeOnly ? "client_coffee" : "client_meal",
        coffeeOnly ? "client_coffee" : "client_meal",
        [`${external.length} external`, coffeeOnly ? "coffee" : "meal", ...unclear],
      );
    }
    const people = Math.max(1, event.attendees.length);
    return decide(
      true,
      people === 1
        ? unclear.length
          ? "Looks like a solo meal, but the details are thin"
          : "Solo meal, a budget is expected"
        : unclear.length
          ? "Looks like a team meal, but the details are thin"
          : "Team meal, a budget is expected",
      confidence,
      "meal",
      people === 1 ? "solo_meal" : "team_meal",
      [people === 1 ? "Just the employee" : `${people} internal attendees`, ...unclear],
    );
  }

  if (external.length > 0) signals.push(`${external.length} external`);
  else signals.push("internal only");

  const slot = mealSlot(event.start, options.timeZone);
  if (slot) signals.push(`${slot} time`);
  if (hasPlace(event)) signals.push("has a place");
  if (VAGUE.test(text)) signals.push("vague title");

  let score = 0;
  if (external.length > 0) score += 2;
  else score -= 3;
  if (slot) score += 1;
  if (hasPlace(event)) score += 1;
  if (VAGUE.test(text)) score -= 2;

  if (external.length > 0 && VAGUE.test(text)) {
    return decide(
      true,
      "Vague title, defaulting to the standard per diem",
      "low",
      "default_per_diem",
      "vague_title",
      signals,
    );
  }

  if (external.length > 0 && slot && hasPlace(event) && score >= 3) {
    return decide(
      true,
      "Looks like a client meal from the time and place. Review before funding.",
      "low",
      "client_meal",
      "classifier",
      signals,
    );
  }

  if (external.length > 0 && slot && score >= 1) {
    return decide(
      true,
      "Meal-time meeting with a guest, defaulting to the standard per diem",
      "low",
      "default_per_diem",
      "classifier",
      signals,
    );
  }

  if (external.length > 0 && hasVenue(event)) {
    return decide(
      true,
      "Client meeting at a venue, spend is unclear",
      "low",
      "default_per_diem",
      "classifier",
      signals,
    );
  }

  if (hasVenue(event)) {
    return decide(
      true,
      "Meeting at a venue, spend is unclear",
      "low",
      slot ? "meal" : "default_per_diem",
      "classifier",
      signals,
    );
  }

  return decide(false, "No spend expected", "high", null, "no_spend", signals);
}
