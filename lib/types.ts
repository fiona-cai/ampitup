export type Attendee = {
  name: string;
  email: string;
};

export type CalendarEvent = {
  id: string;
  title: string;
  description: string;
  location: string;
  start: string;
  end: string;
  city: string;
  attendees: Attendee[];
};

export type SpendCategory =
  | "client_meal"
  | "meal"
  | "client_coffee"
  | "transport"
  | "default_per_diem";

export type JevDecision = {
  needsBudget: boolean;
  reason: string;
  confidence: "high" | "low";
  category: SpendCategory | null;
  rule: string;
  signals: string[];
};

export type BudgetQuote = {
  amount: number;
  currency: "USD";
  category: SpendCategory;
  reason: string;
  policyRule: string;
  source: "claude" | "policy";
  rawAmount: number;
  clamped: boolean;
  cap: number;
};

export type ApprovalStatus = "pending" | "approved" | "rejected";

export type SpendLimit = {
  id: string;
  eventId: string;
  amount: number;
  currency: "USD";
  activeFrom: string;
  activeUntil: string;
  spent: number;
};

export type ChargeAttempt = {
  id: string;
  requestId?: string;
  merchant: string;
  amount: number;
  time: string;
  result: "approved" | "declined";
  eventId: string | null;
  eventTitle: string | null;
  detail: string;
  report: string | null;
};

export type PricedEvent = {
  event: CalendarEvent;
  jev: JevDecision;
  budget: BudgetQuote | null;
  approval: ApprovalStatus;
  limit: SpendLimit | null;
  /** Removed/cancelled source record retained for audit; cannot fund charges. */
  archived?: boolean;
};

export type Employee = {
  name: string;
  email: string;
  company: string;
  companyDomain: string;
  homeCity: string;
};

export type CalendarSource = "google";

export type SyncWindow = {
  label: string;
  start: string;
  end: string;
};

export type AppState = {
  connected: boolean;
  synced: boolean;
  pricer: "claude" | "policy" | "mixed" | null;
  employee: Employee;
  window: SyncWindow;
  source: CalendarSource;
  sourceNote: string | null;
  events: PricedEvent[];
  charges: ChargeAttempt[];
  chargeRequests?: Record<string, { fingerprint: string; charge: ChargeAttempt }>;
};

export type DayRow = {
  date: string;
  label: string;
  travelCity: string | null;
  perDiem: number;
  budgeted: number;
  reimbursed: number;
  unused: number;
};

export type SpendSummary = {
  days: DayRow[];
  travelDays: number;
  perDiems: number;
  reimbursed: number;
  todayCost: number;
  allotted: number;
  saved: number;
  allotReimbursements: number;
  budgetedEvents: number;
  noBudgetEvents: number;
  narrative: string;
};

export type AppResponse = AppState & {
  summary: SpendSummary | null;
  googleConfigured: boolean;
  storage: "redis" | "file" | "ephemeral";
};

export type SignedOutResponse = {
  error: string;
  signedIn: false;
  googleConfigured: boolean;
};
