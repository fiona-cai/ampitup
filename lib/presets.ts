export const chargePresets = [
  {
    id: "over-lunch",
    label: "$90 at 1:00 PM",
    hint: "Solo lunch is capped at $25",
    amount: 90,
    time: "2026-10-06T13:00:00-04:00",
    merchant: "Sweetgreen",
  },
  {
    id: "dinner",
    label: "$180 at 7:30 PM",
    hint: "Acme dinner is capped at $240",
    amount: 180,
    time: "2026-10-06T19:30:00-04:00",
    merchant: "Gramercy Tavern",
  },
] as const;
