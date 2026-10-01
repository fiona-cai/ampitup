import { policy, sameCity } from "./policy";
import { dayKey, formatDayKey, formatMoney } from "./time";
import type { PricedEvent, SpendSummary } from "./types";

function activeBudget(event: PricedEvent): number {
  if (!event.budget || event.approval === "rejected") return 0;
  return event.budget.amount;
}

// Without ContextCard, travel days get a flat per diem for meals and everything else is paid out of pocket
// and reimbursed. Real costs get paid either way; the gap is per diem money that no event needed.
export function summarize(events: PricedEvent[], homeCity: string): SpendSummary {
  const dates = [...new Set(events.map((event) => dayKey(event.event.start)))].sort();
  const pool = policy.perDiem.dailyPool;

  const days = dates.map((date) => {
    const onDay = events.filter((event) => dayKey(event.event.start) === date);
    const away = onDay.find((event) => !sameCity(event.event.city, homeCity));
    const meals = onDay
      .filter((event) => event.budget && event.budget.category !== "transport")
      .reduce((sum, event) => sum + activeBudget(event), 0);
    const transport = onDay
      .filter((event) => event.budget?.category === "transport")
      .reduce((sum, event) => sum + activeBudget(event), 0);
    const perDiem = away ? pool : 0;

    return {
      date,
      label: formatDayKey(date),
      travelCity: away ? away.event.city : null,
      perDiem,
      budgeted: meals + transport,
      reimbursed: Math.max(0, meals - perDiem) + transport,
      unused: Math.max(0, perDiem - meals),
    };
  });

  const perDiems = days.reduce((sum, day) => sum + day.perDiem, 0);
  const reimbursed = days.reduce((sum, day) => sum + day.reimbursed, 0);
  const todayCost = perDiems + reimbursed;
  const contextCard = events.reduce((sum, event) => sum + activeBudget(event), 0);
  const travelDays = days.filter((day) => day.travelCity).length;
  const budgetedEvents = events.filter((event) => event.budget && event.approval !== "rejected").length;

  const perDiemPart =
    travelDays > 0 ? `${formatMoney(perDiems)} in travel per diems plus ` : "";

  return {
    days,
    travelDays,
    perDiems,
    reimbursed,
    todayCost,
    contextCard,
    saved: todayCost - contextCard,
    contextReimbursements: 0,
    budgetedEvents,
    noBudgetEvents: events.length - budgetedEvents,
    narrative: `Without ContextCard, this week costs ${perDiemPart}${formatMoney(reimbursed)} in reimbursements. With it, ${formatMoney(contextCard)} is funded up front against named events and nobody files an expense report.`,
  };
}
