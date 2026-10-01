import { policy } from "./policy";
import { dayKey, formatDayKey, formatMoney } from "./time";
import type { PricedEvent, SpendCategory, TripSummary } from "./types";

function countsAsMeal(category: SpendCategory): boolean {
  return category !== "transport";
}

function activeBudget(event: PricedEvent): number {
  if (!event.budget || event.approval === "rejected") return 0;
  return event.budget.amount;
}

export function summarize(events: PricedEvent[]): TripSummary {
  const dates = [...new Set(events.map((event) => dayKey(event.event.start)))].sort();
  const pool = policy.perDiem.dailyPool;

  const days = dates.map((date) => {
    const mealNeed = events
      .filter((event) => dayKey(event.event.start) === date && event.budget && countsAsMeal(event.budget.category))
      .reduce((sum, event) => sum + activeBudget(event), 0);
    return {
      date,
      label: formatDayKey(date),
      pool,
      mealNeed,
      shortfall: Math.max(0, mealNeed - pool),
      idle: Math.max(0, pool - mealNeed),
    };
  });

  const perDiemPool = days.length * pool;
  const mealShortfall = days.reduce((sum, day) => sum + day.shortfall, 0);
  const transport = events
    .filter((event) => event.budget?.category === "transport")
    .reduce((sum, event) => sum + activeBudget(event), 0);
  const perDiemReimbursements = mealShortfall + transport;
  const perDiemTrueCost = perDiemPool + perDiemReimbursements;
  const contextCard = events.reduce((sum, event) => sum + activeBudget(event), 0);
  const saved = perDiemTrueCost - contextCard;
  const budgetedEvents = events.filter((event) => event.budget && event.approval !== "rejected").length;
  const noBudgetEvents = events.filter((event) => !event.budget || event.approval === "rejected").length;

  return {
    days,
    perDiemPool,
    mealShortfall,
    transport,
    perDiemReimbursements,
    perDiemTrueCost,
    contextCard,
    saved,
    contextReimbursements: 0,
    budgetedEvents,
    noBudgetEvents,
    narrative: `A ${formatMoney(perDiemPool)} daily pool still comes back with ${formatMoney(perDiemReimbursements)} in reimbursements. ContextCard issues ${formatMoney(contextCard)} against named events and files nothing.`,
  };
}
