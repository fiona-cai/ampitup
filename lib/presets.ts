import { addMinutes, formatMoney, formatTime } from "./time";
import type { PricedEvent } from "./types";

export type ChargePreset = {
  id: string;
  eventId: string;
  label: string;
  hint: string;
  amount: number;
  time: string;
  merchant: string;
};

function merchantFor(event: PricedEvent): string {
  const place = event.event.location.split(",")[0]?.trim();
  return place || event.event.title;
}

// One charge that overspends the first solo meal and one that fits inside the biggest meal.
export function buildPresets(events: PricedEvent[]): ChargePreset[] {
  const meals = events.filter(
    (event) => event.budget && event.approval !== "rejected" && event.budget.category !== "transport",
  );
  const presets: ChargePreset[] = [];

  const small =
    meals.find((event) => event.budget?.category === "meal" && event.event.attendees.length <= 1) ??
    [...meals].sort((a, b) => (a.budget?.amount ?? 0) - (b.budget?.amount ?? 0))[0];
  const big = [...meals].sort((a, b) => (b.budget?.amount ?? 0) - (a.budget?.amount ?? 0))[0];

  if (small?.budget) {
    const amount = Math.max(90, small.budget.amount + 40);
    const time = addMinutes(small.event.start, 15);
    presets.push({
      id: "over",
      eventId: small.event.id,
      label: `${formatMoney(amount)} at ${formatTime(time)}`,
      hint: `${small.event.title} is capped at ${formatMoney(small.budget.amount)}`,
      amount,
      time,
      merchant: merchantFor(small),
    });
  }

  if (big?.budget && big !== small) {
    const amount = Math.round(big.budget.amount * 0.75);
    const time = addMinutes(big.event.start, 30);
    presets.push({
      id: "within",
      eventId: big.event.id,
      label: `${formatMoney(amount)} at ${formatTime(time)}`,
      hint: `${big.event.title} is capped at ${formatMoney(big.budget.amount)}`,
      amount,
      time,
      merchant: merchantFor(big),
    });
  }

  return presets;
}
