import fs from "fs";
import path from "path";
import { demoEmployee, demoWindow } from "./seed";
import type { AppState } from "./types";

const statePath = path.join(process.cwd(), "data", "state.json");

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

export function readState(): AppState {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8")) as AppState;
    if (!parsed?.employee?.companyDomain || !parsed.window || !parsed.source || !Array.isArray(parsed.events)) {
      return blankState();
    }
    return parsed;
  } catch {
    return blankState();
  }
}

export function writeState(state: AppState): AppState {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  return state;
}
