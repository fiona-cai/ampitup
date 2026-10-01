import { isExternal } from "./attendees";
import { cityRate, policy, type Policy } from "./policy";
import { mealSlot, type MealSlot } from "./time";
import type { BudgetQuote, CalendarEvent, JevDecision, SpendCategory } from "./types";

type Cap = { cap: number; policyRule: string };

function people(event: CalendarEvent): number {
  return Math.max(1, event.attendees.length);
}

function slotOf(event: CalendarEvent): MealSlot {
  return mealSlot(event.start) ?? "dinner";
}

export function capFor(event: CalendarEvent, category: SpendCategory, rules: Policy = policy): Cap {
  const count = people(event);
  const slot = slotOf(event);

  if (category === "client_meal") {
    const cap = rules.clientEntertainment.perPerson * count;
    return { cap, policyRule: rules.clientEntertainment.label };
  }

  if (category === "client_coffee") {
    const each = rules.meals.coffee.perPerson;
    return { cap: each * count, policyRule: `Coffee cap $${each}/person` };
  }

  if (category === "meal") {
    const row = rules.meals[slot];
    if (count === 1) {
      return { cap: row.solo, policyRule: `Solo ${slot} cap $${row.solo}` };
    }
    return { cap: row.perPerson * count, policyRule: `${slot} cap $${row.perPerson}/person` };
  }

  if (category === "transport") {
    const airport = /airport|yyz|lga|jfk|ewr|pearson/i.test(`${event.title} ${event.location}`);
    const cap = airport ? rules.transport.airportMax : rules.transport.localMax;
    return {
      cap,
      policyRule: airport ? `Airport transfer cap $${cap}` : `Local ride cap $${cap}`,
    };
  }

  const perDiem = rules.perDiem[slot];
  return { cap: perDiem, policyRule: `Standard ${slot} per diem $${perDiem}` };
}

export function clampAmount(amount: number, cap: number): Pick<BudgetQuote, "amount" | "rawAmount" | "clamped" | "cap"> {
  const rawAmount = Number.isFinite(amount) ? Math.max(0, Math.round(amount)) : 0;
  return {
    rawAmount,
    amount: Math.min(rawAmount, cap),
    clamped: rawAmount > cap,
    cap,
  };
}

function whenLabel(slot: MealSlot): string {
  if (slot === "breakfast") return "morning";
  if (slot === "dinner") return "evening";
  return "midday";
}

export function quoteFromPolicy(event: CalendarEvent, jev: JevDecision, rules: Policy = policy): BudgetQuote {
  const category = jev.category ?? "default_per_diem";
  const { cap, policyRule } = capFor(event, category, rules);
  const count = people(event);
  const city = cityRate(event.city);
  const slot = slotOf(event);
  let amount = cap;
  let reason = policyRule;

  if (category === "client_meal") {
    amount = count * city.clientMealPerPerson;
    reason = `${count} attendees × $${city.clientMealPerPerson}, ${city.label}`;
  } else if (category === "client_coffee") {
    amount = count * city.coffeePerPerson;
    reason = `${count} attendees, coffee, ${city.label}`;
  } else if (category === "meal") {
    const rate =
      slot === "breakfast" ? city.soloBreakfast : slot === "dinner" ? city.soloDinner : city.soloLunch;
    amount = count === 1 ? rate : rate * count;
    reason =
      count === 1
        ? `Single attendee, ${whenLabel(slot)}, local rates`
        : `${count} attendees, ${whenLabel(slot)}, local rates`;
  } else if (category === "transport") {
    const airport = /airport|yyz|lga|jfk|ewr|pearson/i.test(`${event.title} ${event.location}`);
    amount = airport ? city.airportTransfer : Math.min(city.airportTransfer, rules.transport.localMax);
    reason = "Distance and time of day";
  } else {
    amount = cap;
    reason = `Vague title, defaulted to the $${cap} ${slot} per diem`;
  }

  const clamped = clampAmount(amount, cap);
  return {
    ...clamped,
    currency: "USD",
    category,
    reason,
    policyRule,
    source: "policy",
  };
}

type ClaudeQuote = {
  amount?: unknown;
  reason?: unknown;
};

function fieldsForModel(event: CalendarEvent, jev: JevDecision, cap: Cap, companyDomain: string) {
  return {
    title: event.title,
    description: event.description,
    location: event.location,
    city: event.city,
    start: event.start,
    end: event.end,
    category: jev.category,
    confidence: jev.confidence,
    cap: cap.cap,
    policyRule: cap.policyRule,
    attendees: event.attendees.map((attendee) => ({
      name: attendee.name,
      external: isExternal(attendee.email, companyDomain),
    })),
    cityRates: cityRate(event.city),
    policy: {
      perDiem: policy.perDiem,
      meals: policy.meals,
      clientEntertainment: policy.clientEntertainment,
      transport: policy.transport,
    },
  };
}

async function quoteWithClaude(
  event: CalendarEvent,
  jev: JevDecision,
  cap: Cap,
  companyDomain: string,
): Promise<BudgetQuote | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !jev.category) return null;

  const model = process.env.ANTHROPIC_MODEL || "claude-sonnet-4-5";
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    signal: AbortSignal.timeout(12_000),
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: 400,
      system: [
        "You set one business expense budget.",
        "Return only JSON with keys amount and reason.",
        "amount is a number in USD at or below the cap in the payload. The server clamps anything higher, and it will not raise the cap if you pick a different category.",
        "reason is one short line a manager can read, with no markdown.",
        "Use the city rates when they fit under the cap.",
      ].join(" "),
      messages: [
        {
          role: "user",
          content: JSON.stringify(fieldsForModel(event, jev, cap, companyDomain)),
        },
      ],
    }),
  });

  if (!response.ok) return null;
  const body = (await response.json()) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const text = (body.content ?? [])
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text)
    .join("\n");
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;

  let parsed: ClaudeQuote;
  try {
    parsed = JSON.parse(match[0]) as ClaudeQuote;
  } catch {
    return null;
  }
  if (typeof parsed.amount !== "number") return null;

  const clamped = clampAmount(parsed.amount, cap.cap);
  const reason =
    typeof parsed.reason === "string" && parsed.reason.trim()
      ? parsed.reason.trim().slice(0, 180)
      : quoteFromPolicy(event, jev).reason;

  return {
    ...clamped,
    currency: "USD",
    category: jev.category,
    reason,
    policyRule: cap.policyRule,
    source: "claude",
  };
}

export async function priceEvent(
  event: CalendarEvent,
  jev: JevDecision,
  companyDomain = policy.companyDomain,
): Promise<BudgetQuote> {
  const fallback = quoteFromPolicy(event, jev);
  if (!jev.category) return fallback;
  try {
    const quoted = await quoteWithClaude(event, jev, capFor(event, jev.category), companyDomain);
    return quoted ?? fallback;
  } catch {
    return fallback;
  }
}
