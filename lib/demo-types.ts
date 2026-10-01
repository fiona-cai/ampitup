import type { BudgetContext, BudgetNeed, EventSnapshot, NormalizedEvent } from "./budget-protocol";
import type { JevDecision } from "./types";

export type DemoSettings = {
  weekStart: string;
  weeklyLimitMinor: number;
  dailyLimitMinor: number;
  monthlyLimitMinor: number;
  spentWeeklyMinor: number;
  spentMonthlyMinor: number;
  spentByDate: Record<string, number>;
  maxDailyHours: number;
  maxWeeklyHours: number;
  maxEventHours: number;
  maxDifficultyHours: number;
};

export type FundingStatus = "ready" | "review" | "no_budget" | "unfunded" | "approved" | "rejected";
export type Funds = { dailyMinor: number; weeklyMinor: number; monthlyMinor: number };
export type LayaGate = {
  rawLabel: BudgetNeed;
  probabilities: Record<BudgetNeed, number>;
  confidence: number;
  inputTokens: number;
  truncated: boolean;
  override: string | null;
};
export type Assignment = {
  id: string;
  eventId: string;
  title: string;
  createdAt: string;
  currency: string;
  category: string;
  city: string | null;
  importance: string;
  durationMinutes: number;
  participants: number | null;
  amountMinor: number;
  rationale: string;
  source: "gpt-6-luna";
  feedback: "too_low" | "appropriate" | "too_high" | null;
  actualMinor: number | null;
};
export type AllocationQuote = {
  eventId: string;
  amountMinor: number;
  lineItems: Array<{ category: string; amountMinor: number }>;
  rationale: string;
  historyIds: string[];
  questions: string[];
};
export type ConditionedEvent = {
  event: NormalizedEvent;
  context: BudgetContext;
  baseline: JevDecision | null;
  need: BudgetNeed;
  status: FundingStatus;
  reason: string;
  conditions: Array<{ name: string; value: string; effect: "positive" | "negative" | "neutral" }>;
  feasibility: { feasible: boolean; conflicts: string[]; travelShortfallMinutes: number; effortHours: number };
  priority: number;
  requestedMinor: number;
  proposedMinor: number;
  allocatedMinor: number;
  shortfallMinor: number;
  remainingBefore: Funds;
  lineItems: Array<{ category: string; requestedMinor: number; cappedMinor: number }>;
  allocation: AllocationQuote | null;
  history: Assignment[];
  classifier: LayaGate | null;
};

export type DemoPlan = {
  runId?: string;
  snapshot: EventSnapshot;
  settings: DemoSettings;
  weeks: string[];
  events: ConditionedEvent[];
  wallet: {
    availableWeeklyMinor: number;
    availableMonthlyMinor: number;
    plannedMinor: number;
    approvedMinor: number;
    remainingWeeklyMinor: number;
    remainingMonthlyMinor: number;
  };
  summary: Record<FundingStatus, number>;
  pricing: { state: "not_run" | "complete"; model: "gpt-6-luna"; elapsedMs: number; calledEvents: number; historyCount: number; newAssignments: number };
  history: Assignment[];
  gateModel: { backend: "laya"; elapsedMs: number; calledEvents: number };
};

export type DemoRequest = {
  dataset?: "month" | "samples";
  snapshot?: unknown;
  settings?: Partial<DemoSettings>;
  approvals?: Record<string, "approved" | "rejected">;
  action?: "preview" | "allocate" | "feedback" | "clear_memory";
  runId?: string;
  feedback?: { assignmentId: string; value: "too_low" | "appropriate" | "too_high"; actualMinor?: number };
};
