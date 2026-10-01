import { getJson, setJson } from "./kv";
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
  };
}

export async function readState(): Promise<AppState> {
  const parsed = await getJson<AppState>("state");
  if (!parsed?.employee?.companyDomain || !parsed.window || !parsed.source || !Array.isArray(parsed.events)) {
    return blankState();
  }
  return parsed;
}

export async function writeState(state: AppState): Promise<AppState> {
  await setJson("state", state);
  return state;
}
