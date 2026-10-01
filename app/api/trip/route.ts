import { NextResponse } from "next/server";
import { loadCalendar } from "@/lib/calendar";
import { priceEvents, pricerLabel } from "@/lib/pipeline";
import { clampAmount } from "@/lib/price";
import { approveBudgeted, authorize, createLimit } from "@/lib/ramp";
import { blankState, readState, writeState } from "@/lib/store";
import { summarize } from "@/lib/summary";
import type { ApprovalStatus, PricedEvent, TripResponse, TripState } from "@/lib/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function present(state: TripState): TripResponse {
  return {
    ...state,
    summary: state.synced ? summarize(state.events) : null,
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
  if (!event.budget) return event;
  const rounded = Math.round(amount);
  if (rounded <= 0) {
    return { ...event, approval: "rejected", limit: null };
  }
  const next: PricedEvent = {
    ...event,
    budget: { ...event.budget, ...clampAmount(rounded, event.budget.cap) },
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
  return { ...event, approval, limit: null };
}

async function handle(body: Record<string, unknown>): Promise<TripState> {
  const action = body.action;
  if (action === "reset") return writeState(blankState());

  const state = readState();

  if (action === "connect") {
    state.connected = true;
    return writeState(state);
  }

  if (action === "sync") {
    const events = await loadCalendar();
    const priced = await priceEvents(events);
    return writeState({
      ...state,
      connected: true,
      synced: true,
      pricer: pricerLabel(priced),
      events: priced,
      charges: [],
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
    if (index < 0) throw new HttpError(400, "That event is not on this trip.");

    let next = state.events[index];
    if (typeof body.amount === "number") next = applyAmount(next, body.amount);
    if (body.approval === "approved" || body.approval === "rejected" || body.approval === "pending") {
      if (next.approval !== "rejected" || body.approval !== "approved" || body.amount === undefined) {
        next = applyApproval(next, body.approval);
      }
    }
    state.events = state.events.map((event, eventIndex) => (eventIndex === index ? next : event));
    return writeState(state);
  }

  if (action === "charge") {
    const amount = Number(body.amount);
    const time = typeof body.time === "string" ? body.time : "";
    const merchant = (typeof body.merchant === "string" && body.merchant.trim() ? body.merchant : "Card swipe").slice(0, 80);
    if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000) {
      throw new HttpError(400, "Enter a charge between $1 and $10,000.");
    }
    if (Number.isNaN(new Date(time).getTime())) throw new HttpError(400, "That charge time is not valid.");
    if (!state.events.some((event) => event.approval === "approved")) {
      throw new HttpError(400, "Approve the trip before trying a charge.");
    }
    const result = authorize(state.events, { amount, time, merchant });
    state.events = result.events;
    state.charges = [result.charge, ...state.charges].slice(0, 12);
    return writeState(state);
  }

  throw new HttpError(400, "Unknown action.");
}

export async function GET() {
  return NextResponse.json(present(readState()));
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body.action !== "string") {
    return NextResponse.json({ error: "Missing request body." }, { status: 400 });
  }

  try {
    const state = await enqueue(() => handle(body));
    return NextResponse.json(present(state));
  } catch (error) {
    if (error instanceof HttpError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Something went wrong.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
