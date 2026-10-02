import { NextResponse } from "next/server";
import path from "node:path";
import { demoMode } from "@/lib/demo-mode";
import { seedEmployee, seedEvents, seedWindow } from "@/lib/seed";
import { CalendarError, loadCalendar } from "@/lib/calendar";
import { clearScriptTokens, googleConfig, refreshed, revoke, type GoogleTokens } from "@/lib/google";
import { storageKind } from "@/lib/kv";
import { priceEvents, pricerLabel } from "@/lib/pipeline";
import { fromCents, toCents } from "@/lib/money";
import { approveBudgeted, createLimit } from "@/lib/ramp";
import { applyStoredCharge, ChargeConflictError } from "@/lib/charges";
import { reconcileEvents } from "@/lib/reconcile";
import { clearSession, readSession, writeSession } from "@/lib/session";
import { blankState, commitStateSnapshot, employeeFromGoogle, readState, readStateSnapshot, StateConflictError } from "@/lib/store";
import { summarize } from "@/lib/summary";
import type { AppResponse, AppState, ApprovalStatus, PricedEvent, SignedOutResponse } from "@/lib/types";

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
  const visible = { ...state };
  // Keep the unbounded idempotency ledger on the server; the UI only needs its
  // bounded recent attempts. Both are persisted by writeState.
  delete visible.chargeRequests;
  return {
    ...visible,
    summary: state.synced ? summarize(state.events, state.employee.homeCity) : null,
    googleConfigured: !demoMode() && googleConfig() !== null,
    storage: demoMode() ? "file" : storageKind(),
  };
}

function signedOut(error = "Sign in with Google to see your events.") {
  const body: SignedOutResponse = { error, signedIn: false, googleConfigured: googleConfig() !== null };
  return NextResponse.json(body, { status: 401 });
}

class SignedOut extends Error {}

async function freshTokens(tokens: GoogleTokens): Promise<GoogleTokens> {
  const next = await refreshed(tokens).catch(() => null);
  if (!next) {
    await clearSession();
    throw new SignedOut("Your Google sign-in expired. Sign in again.");
  }
  if (next !== tokens) await writeSession(next);
  return next;
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

function demoFile() { return demoMode() ? path.join(process.cwd(), "data/demo-state.json") : undefined; }

async function handle(tokens: GoogleTokens | null, body: Record<string, unknown>): Promise<AppState> {
  const action = body.action;
  const owner = demoMode() ? seedEmployee : employeeFromGoogle(tokens!.email, tokens!.name);
  const snapshot = await readStateSnapshot(owner, demoFile());
  const state = snapshot.state;
  const persist = (next: AppState) => commitStateSnapshot(snapshot, next, demoFile());

  if (action === "reset") {
    const blank = blankState(state.employee);
    return persist(demoMode() ? { ...blank, source: "sample", window: seedWindow } : blank);
  }

  if (action === "profile") {
    const homeCity = typeof body.homeCity === "string" ? body.homeCity.trim().slice(0, 60) : "";
    if (!homeCity) throw new HttpError(400, "Enter the city you're based in.");
    return persist({ ...state, employee: { ...state.employee, homeCity } });
  }

  if (action === "sync") {
    const fresh = demoMode() ? null : await freshTokens(tokens!);
    let load;
    try {
      load = demoMode()
        ? { events: seedEvents(), source: "sample" as const, window: seedWindow, note: "Demo mode · synthetic events and simulated card limits." }
        : await loadCalendar(fresh!.accessToken, state.employee.homeCity);
    } catch (error) {
      if (error instanceof CalendarError && error.status === 401) {
        await clearSession();
        throw new SignedOut(error.message);
      }
      throw error;
    }
    const priced = await priceEvents(load.events, state.employee.companyDomain);
    return persist({
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
      return persist(state);
    }
    const eventId = typeof body.eventId === "string" ? body.eventId : "";
    const index = state.events.findIndex((event) => event.event.id === eventId);
    if (index < 0) throw new HttpError(400, "That event is not on this calendar.");

    let next = state.events[index];
    if (next.archived && (body.amount !== undefined || body.approval === "approved" || body.approval === "pending")) {
      throw new HttpError(400, "This event is no longer in the active calendar. Sync it again before changing or approving its budget.");
    }
    if (body.amount !== undefined) {
      if (typeof body.amount !== "number") throw new HttpError(400, "Budget amount must be a number.");
      next = applyAmount(next, body.amount);
    }
    if (body.approval === "approved" || body.approval === "rejected" || body.approval === "pending") {
      next = applyApproval(next, body.approval);
    }
    state.events = state.events.map((event, eventIndex) => (eventIndex === index ? next : event));
    return persist(state);
  }

  if (action === "charge") {
    const amount = typeof body.amount === "number" ? body.amount : NaN;
    const time = typeof body.time === "string" ? body.time : "";
    const merchant = typeof body.merchant === "string" ? body.merchant : "Card swipe";
    if (body.eventId !== undefined && typeof body.eventId !== "string") throw new HttpError(400, "Event identity must be a string.");
    if (body.requestId !== undefined && typeof body.requestId !== "string") throw new HttpError(400, "Request identity must be a string.");
    const input = {
      amount, time, merchant,
      eventId: typeof body.eventId === "string" ? body.eventId : undefined,
      requestId: typeof body.requestId === "string" ? body.requestId : undefined,
    };
    let current = snapshot;
    for (let attempt = 0; attempt < 5; attempt++) {
      const result = applyStoredCharge(current.state, input);
      try { return await commitStateSnapshot(current, result.state, demoFile()); }
      catch (error) {
        if (!(error instanceof StateConflictError) || attempt === 4) throw error;
        current = await readStateSnapshot(owner, demoFile());
      }
    }
    throw new StateConflictError();
  }

  throw new HttpError(400, "Unknown action.");
}

export async function GET() {
  if (demoMode()) {
    const state = await enqueue(async () => {
      const saved = await readState(seedEmployee, demoFile());
      return saved.synced ? saved : handle(null, { action: "sync" });
    });
    return NextResponse.json(await present(state));
  }
  const tokens = await readSession();
  if (!tokens) return signedOut();
  return NextResponse.json(await present(await readState(employeeFromGoogle(tokens.email, tokens.name))));
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") {
    return NextResponse.json({ error: "Missing request body." }, { status: 400 });
  }

  const tokens = demoMode() ? null : await readSession();
  if (!demoMode() && !tokens) return signedOut();
  if (body.action === "signout") {
    if (demoMode()) return NextResponse.json(await present(await enqueue(() => handle(null, { action: "sync" }))));
    await revoke(tokens!);
    await clearSession();
    await clearScriptTokens(tokens!.email);
    return signedOut("Signed out.");
  }

  try {
    const state = await enqueue(() => handle(tokens, body));
    return NextResponse.json(await present(state));
  } catch (error) {
    if (error instanceof SignedOut) return signedOut(error.message);
    if (error instanceof CalendarError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof ChargeConflictError || error instanceof StateConflictError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
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
