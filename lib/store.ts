import { compareAndSetJson, readJsonSnapshot } from "./kv";
import fs from "node:fs";
import path from "node:path";
import type { AppState, Employee } from "./types";

export function employeeFromGoogle(email: string, name: string, homeCity?: string): Employee {
  const domain = (process.env.COMPANY_DOMAIN || email.split("@")[1] || "").toLowerCase();
  return {
    name,
    email,
    company: process.env.COMPANY_NAME || domain,
    companyDomain: domain,
    homeCity: homeCity || process.env.HOME_CITY || "",
  };
}

export function blankState(employee: Employee): AppState {
  const now = new Date();
  return {
    connected: true,
    synced: false,
    pricer: null,
    employee,
    window: {
      label: "Next 7 days",
      start: now.toISOString(),
      end: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    },
    source: "google",
    sourceNote: null,
    events: [],
    charges: [],
    chargeRequests: {},
  };
}

function stateKey(email: string): string {
  return `state:${email.toLowerCase()}`;
}

export type StateSnapshot = { state: AppState; raw: string | null; key: string };
export class StateConflictError extends Error {
  constructor() { super("The event state changed during this request. Refresh and try again."); this.name = "StateConflictError"; }
}

/** An explicit path isolates tests from configured Redis and application state. */
export async function readStateSnapshot(owner: Employee, filePath?: string): Promise<StateSnapshot> {
  const key = stateKey(owner.email);
  let parsed: AppState | null, raw: string | null;
  if (filePath !== undefined) {
    try { raw = fs.readFileSync(filePath, "utf8"); parsed = JSON.parse(raw) as AppState; }
    catch { return { state: blankState(owner), raw: null, key }; }
  } else {
    const snapshot = await readJsonSnapshot<AppState>(key);
    parsed = snapshot.value; raw = snapshot.raw;
  }
  if (!parsed?.employee?.companyDomain || !parsed.window || !Array.isArray(parsed.events)) {
    return { state: blankState(owner), raw, key };
  }
  return {
    state: {
      ...parsed,
      employee: { ...owner, homeCity: parsed.employee.homeCity || owner.homeCity },
      charges: Array.isArray(parsed.charges) ? parsed.charges : [],
      chargeRequests: parsed.chargeRequests ?? {},
    },
    raw,
    key,
  };
}

export async function readState(owner: Employee, filePath?: string): Promise<AppState> {
  return (await readStateSnapshot(owner, filePath)).state;
}

export async function commitStateSnapshot(snapshot: StateSnapshot, state: AppState, filePath?: string): Promise<AppState> {
  let committed: boolean;
  if (filePath !== undefined) {
    let current: string | null = null;
    try { current = fs.readFileSync(filePath, "utf8"); } catch { /* Missing test file. */ }
    committed = current === snapshot.raw;
    if (committed) {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
    }
  } else {
    committed = await compareAndSetJson(snapshot.key, snapshot.raw, state);
  }
  if (!committed) throw new StateConflictError();
  return state;
}

/** Used for explicit replacements such as the first sign-in. */
export async function writeState(state: AppState, filePath?: string): Promise<AppState> {
  return commitStateSnapshot(await readStateSnapshot(state.employee, filePath), state, filePath);
}
