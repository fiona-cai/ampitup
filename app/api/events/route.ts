import { NextResponse } from "next/server";
import { loadCalendar } from "@/lib/calendar";
import { clearTokens, googleConfig, readTokens } from "@/lib/google";
import { storageKind } from "@/lib/kv";
import { priceEvents, pricerLabel } from "@/lib/pipeline";
import { fromCents, toCents } from "@/lib/money";
import { approveBudgeted, authorize, createLimit } from "@/lib/ramp";
import { reconcileEvents } from "@/lib/reconcile";
import { demoEmployee, employeeFromGoogle } from "@/lib/seed";
import { blankState, readState, writeState } from "@/lib/store";
import { summarize } from "@/lib/summary";
import type { AppResponse, AppState, ApprovalStatus, PricedEvent } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function present(state: AppState): Promise<AppResponse> {
  return {
    ...state,
    summary: state.synced ? summarize(state.events, state.employee.homeCity) : null,
    googleConfigured: googleConfig() !== null,
    googleAccount: (await readTokens())?.email ?? null,
    storage: storageKind(),
  };
}

let queue: Promise<unknown> = Promise.resolve();

function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const run = queue.then(job, job);
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

function applyAmount(event: PricedEvent, amount: number): PricedEvent {
  const cents = toCents(amount);
  if (cents === null) throw new HttpError(400, "Budget amounts must be nonnegative dollars with at most two decimal places.");
  if (!event.budget) return event;
  if (cents === 0) {
    return { ...event, approval: "rejected" };
  }
  const capCents = toCents(event.budget.cap);
  if (capCents === null) throw new HttpError(400, "This budget's policy cap needs review.");
  const next: PricedEvent = {
    ...event,
    budget: {
      ...event.budget,
      amount: fromCents(Math.min(cents, capCents)),
      rawAmount: amount,
      clamped: cents > capCents,
    },
  };
  if (next.approval === "approved") {
    next.limit = createLimit(next, next.limit);
  }
  return next;
}

function applyApproval(event: PricedEvent, approval: ApprovalStatus): PricedEvent {
  if (approval === "approved") {
    if (!event.budget) return event;
    return { ...event, approval, limit: createLimit(event, event.limit) };
  }
  return { ...event, approval };
}

async function handle(body: Record<string, unknown>): Promise<AppState> {
  const action = body.action;
  if (action === "reset") {
    const tokens = await readTokens();
    if (!tokens) return writeState(blankState());
    return writeState({ ...blankState(), connected: true, employee: employeeFromGoogle(tokens.email, tokens.name) });
  }

  if (action === "signout") {
    await clearTokens();
    return writeState(blankState());
  }

  const state = await readState();

  if (action === "connect") {
    state.connected = true;
    return writeState(state);
  }

  if (action === "sync") {
    const load = await loadCalendar(state.employee.homeCity);
    const domain = load.source === "google" ? state.employee.companyDomain : demoEmployee.companyDomain;
    const priced = await priceEvents(load.events, domain);
    return writeState({
      ...state,
      connected: true,
      synced: true,
      pricer: pricerLabel(priced),
      window: load.window,
      source: load.source,
      sourceNote: load.note,
      events: reconcileEvents(state.events, priced),
      charges: state.charges,
    });
  }

  if (action === "decide") {
    if (!state.synced) throw new HttpError(400, "Sync the calendar before reviewing budgets.");
    if (body.all === true) {
      state.events = approveBudgeted(state.events);
      return writeState(state);
    }
    const eventId = typeof body.eventId === "string" ? body.eventId : "";
    const index = state.events.findIndex((event) => event.event.id === eventId);
    if (index < 0) throw new HttpError(400, "That event is not on this calendar.");

    let next = state.events[index];
    if (body.amount !== undefined) {
      if (typeof body.amount !== "number") throw new HttpError(400, "Budget amount must be a number.");
      next = applyAmount(next, body.amount);
    }
    if (body.approval === "approved" || body.approval === "rejected" || body.approval === "pending") {
      next = applyApproval(next, body.approval);
    }
    state.events = state.events.map((event, eventIndex) => (eventIndex === index ? next : event));
    return writeState(state);
  }

  if (action === "charge") {
    const amount = typeof body.amount === "number" ? body.amount : NaN;
    const time = typeof body.time === "string" ? body.time : "";
    const merchant = (typeof body.merchant === "string" && body.merchant.trim() ? body.merchant : "Card swipe").slice(0, 80);
    if (body.eventId !== undefined && typeof body.eventId !== "string") throw new HttpError(400, "Event identity must be a string.");
    if (body.requestId !== undefined && typeof body.requestId !== "string") throw new HttpError(400, "Request identity must be a string.");
    if (!state.events.some((event) => event.approval === "approved")) {
      throw new HttpError(400, "Approve at least one budget before trying a charge.");
    }
    const result = authorize(state.events, {
      amount, time, merchant,
      eventId: typeof body.eventId === "string" ? body.eventId : undefined,
      requestId: typeof body.requestId === "string" ? body.requestId : undefined,
    });
    state.events = result.events;
    state.charges = [result.charge, ...state.charges].slice(0, 12);
    return writeState(state);
  }

  throw new HttpError(400, "Unknown action.");
}

export async function GET() {
  return NextResponse.json(await present(await readState()));
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") {
    return NextResponse.json({ error: "Missing request body." }, { status: 400 });
  }

  try {
    const state = await enqueue(() => handle(body));
    return NextResponse.json(await present(state));
  } catch (error) {
    if (error instanceof TypeError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
