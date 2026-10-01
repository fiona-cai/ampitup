/** Connector contract v1.0. The authoritative wire schema is protocol/budget.schema.json. */
export type ExpenseCategory = "meal" | "coffee" | "transport" | "lodging" | "admission" | "supplies" | "other";
export type BudgetNeed = "needs_budget" | "no_budget" | "needs_review";

export interface NormalizedEvent {
  /** Stable, namespaced ID. An edit keeps this ID; recurring instances get separate IDs. */
  id: string;
  sources: Array<{
    provider: string;
    collectionId: string;
    recordId: string;
    updatedAt: string;
    url: string | null;
  }>;
  title: string;
  description: string | null;
  status: "confirmed" | "tentative" | "cancelled";
  attendance: "accepted" | "tentative" | "declined" | "unknown";
  schedule: { start: string; end: string; timeZone: string; allDay: boolean };
  purpose: {
    scope: "work" | "personal" | "unknown";
    importance: "low" | "normal" | "high" | "unknown";
    difficulty: "low" | "moderate" | "high" | "unknown";
  };
  location: {
    mode: "in_person" | "virtual" | "hybrid" | "unknown";
    label: string | null;
    city: string | null;
    countryCode: string | null;
    /** A supplied travel estimate, not a value inferred from a city name. */
    travelFromPreviousMinutes: number | null;
  };
  participants: { totalCount: number | null; externalCount: number | null };
  /** null is unknown; [] is confirmed no expected expense. All money uses policy.currency. */
  expenses: Array<{
    category: ExpenseCategory;
    coverage: "not_covered" | "provided" | "prepaid" | "unknown";
    estimatedAmountMinor: number | null;
    beneficiaryCount: number | null;
    notes: string | null;
  }> | null;
  /** Event-relative JSON pointers, e.g. /location/city. */
  missingFields: string[];
}

export interface BudgetPolicy {
  id: string;
  currency: string;
  fundingScope: "work";
  dailyLimitMinor: number;
  weeklyLimitMinor: number;
  monthlyLimitMinor: number;
  /** Per event and per category, including all beneficiaries. */
  categoryCapsMinor: Record<ExpenseCategory, number>;
}

export interface EventSnapshot {
  schemaVersion: "1.0";
  snapshotId: string;
  generatedAt: string;
  isSimulated: boolean;
  subject: { id: string; timeZone: string; homeCity: string | null };
  /** Half-open interval: start inclusive, end exclusive. */
  window: { start: string; end: string };
  policy: BudgetPolicy;
  events: NormalizedEvent[];
}

export interface EventLoad {
  eventCount: number;
  busyMinutes: number;
  highDifficultyCount: number;
  allDayCount: number;
  /** False for a partial day/week at the edge of the snapshot. */
  complete: boolean;
}

export interface BudgetContext {
  date: string;
  weekStart: string;
  durationMinutes: number;
  day: EventLoad;
  week: EventLoad;
  nearMealTime: boolean;
  transition: {
    previousEventId: string | null;
    gapMinutes: number | null;
    travelMinutes: number | null;
    timePressure: boolean | null;
  };
}

export interface BudgetGate {
  label: BudgetNeed;
  rawLabel: BudgetNeed;
  probabilities: Record<BudgetNeed, number>;
  /** Probability of rawLabel, not a measured accuracy guarantee. */
  confidence: number;
  reviewReasons: string[];
  /** Derived by code; Laya does not generate an explanation. */
  signals: string[];
  backend: "laya" | "mock" | "policy_guard";
  modelId: string | null;
}

export interface BudgetGateRequest {
  schemaVersion: "1.0";
  requestId: string;
  event: NormalizedEvent;
  context: BudgetContext;
  policy: BudgetPolicy;
}

export interface BudgetPricingRequest extends BudgetGateRequest {
  gate: BudgetGate;
  remaining: { dailyMinor: number; weeklyMinor: number; monthlyMinor: number };
}

export interface BudgetProposal {
  eventId: string;
  currency: string;
  amountMinor: number;
  lineItems: Array<{ category: ExpenseCategory; amountMinor: number }>;
  reason: string;
  questions: string[];
}
