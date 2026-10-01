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
    events: [],
    charges: [],
  };
}

export function readState(): AppState {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8")) as AppState;
    if (!parsed?.employee?.homeCity || !parsed.window || !Array.isArray(parsed.events)) return blankState();
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
