import { createHash } from "node:crypto";
import { toCents } from "./money";
import { authorize, type ChargeInput } from "./ramp";
import { parseInstant } from "./time";
import type { AppState, ChargeAttempt } from "./types";

export class ChargeConflictError extends Error {
  constructor() {
    super("This charge request ID was already used with different charge details. Use a new request ID for a new attempt.");
    this.name = "ChargeConflictError";
  }
}

/** Normalize only what the authorization engine treats as equivalent. */
export function canonicalChargeInput(input: ChargeInput): ChargeInput {
  const amountMinor = toCents(input.amount);
  if (amountMinor === null || amountMinor <= 0 || amountMinor > 1_000_000) {
    throw new TypeError("Enter a positive charge up to $10,000 using at most two decimal places.");
  }
  const instant = parseInstant(input.time);
  if (instant === null) throw new TypeError("Charge time must be a valid ISO timestamp with an explicit timezone offset.");
  if (input.eventId !== undefined && (typeof input.eventId !== "string" || !input.eventId.trim() || input.eventId.length > 200)) {
    throw new TypeError("That event identity is not valid.");
  }
  if (input.requestId !== undefined && (typeof input.requestId !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/.test(input.requestId))) {
    throw new TypeError("That charge request identity is not valid.");
  }
  return {
    amount: amountMinor / 100,
    time: new Date(instant).toISOString(),
    merchant: typeof input.merchant === "string" && input.merchant.trim() ? input.merchant.trim().slice(0, 80) : "Card swipe",
    ...(input.eventId !== undefined ? { eventId: input.eventId } : {}),
    ...(input.requestId !== undefined ? { requestId: input.requestId } : {}),
  };
}

export function chargeFingerprint(input: ChargeInput): string {
  const canonical = canonicalChargeInput(input);
  return createHash("sha256").update(JSON.stringify([
    toCents(canonical.amount), canonical.time, canonical.merchant, canonical.eventId ?? null,
  ])).digest("hex");
}

/** Caller serializes this read/authorize/persist operation through the route's process queue. */
export function applyStoredCharge(state: AppState, input: ChargeInput): { state: AppState; charge: ChargeAttempt; replayed: boolean } {
  const canonical = canonicalChargeInput(input);
  const requestId = canonical.requestId;
  const fingerprint = chargeFingerprint(canonical);
  const receipts = state.chargeRequests ?? {};
  const saved = requestId && Object.hasOwn(receipts, requestId) ? receipts[requestId] : undefined;
  if (saved) {
    if (saved.fingerprint !== fingerprint) throw new ChargeConflictError();
    // Surface the original result through the existing response contract. It is
    // the same attempt even if its receipt has aged out of the 12-row UI list.
    const charges = [saved.charge, ...state.charges.filter((charge) => charge.id !== saved.charge.id)].slice(0, 12);
    return { state: { ...state, charges }, charge: saved.charge, replayed: true };
  }
  // Replays are resolved before current approval checks: revoking a budget must
  // not change the answer to a previously completed request.
  if (!state.events.some((event) => event.approval === "approved" && !event.archived)) {
    throw new TypeError("Approve at least one budget before trying a charge.");
  }
  const result = authorize(state.events, canonical);
  const charge: ChargeAttempt = { ...result.charge, ...(requestId ? { requestId } : {}) };
  return {
    state: {
      ...state,
      events: result.events,
      charges: [charge, ...state.charges].slice(0, 12),
      ...(requestId ? { chargeRequests: { ...receipts, [requestId]: { fingerprint, charge } } } : {}),
    },
    charge,
    replayed: false,
  };
}
