import { compareAndSetJson, readJsonSnapshot } from "./kv";
import fs from "node:fs";
import path from "node:path";
import { demoEmployee, demoWindow } from "./seed";
import type { AppState } from "./types";

export function blankState(): AppState {
  return {
    connected: false,
    synced: false,
    pricer: null,
    employee: demoEmployee,
    window: demoWindow,
    source: "sample",
    sourceNote: null,
    events: [],
    charges: [],
    chargeRequests: {},
  };
}

export type StateSnapshot = { state: AppState; raw: string | null };
export class StateConflictError extends Error {
  constructor() { super("The event state changed during this request. Refresh and try again."); this.name = "StateConflictError"; }
}

/** An explicit path isolates tests from configured Redis and application state. */
export async function readStateSnapshot(filePath?: string): Promise<StateSnapshot> {
  let parsed: AppState | null, raw: string | null;
  if (filePath !== undefined) {
    try { raw = fs.readFileSync(filePath, "utf8"); parsed = JSON.parse(raw) as AppState; }
    catch { return { state: blankState(), raw: null }; }
  } else {
    const snapshot = await readJsonSnapshot<AppState>("state");
    parsed = snapshot.value; raw = snapshot.raw;
  }
  if (!parsed?.employee?.companyDomain || !parsed.window || !parsed.source || !Array.isArray(parsed.events)) {
    return { state: blankState(), raw };
  }
  return { state: { ...parsed, charges: Array.isArray(parsed.charges) ? parsed.charges : [], chargeRequests: parsed.chargeRequests ?? {} }, raw };
}

export async function readState(filePath?: string): Promise<AppState> {
  return (await readStateSnapshot(filePath)).state;
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
    committed = await compareAndSetJson("state", snapshot.raw, state);
  }
  if (!committed) throw new StateConflictError();
  return state;
}

/** Used for explicit replacements such as the Google account handoff. */
export async function writeState(state: AppState, filePath?: string): Promise<AppState> {
  return commitStateSnapshot(await readStateSnapshot(filePath), state, filePath);
}
