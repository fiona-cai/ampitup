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
    chargeRequests: {},
  };
}

export function readState(filePath = statePath): AppState {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as AppState;
    if (!parsed?.employee?.companyDomain || !parsed.window || !parsed.source || !Array.isArray(parsed.events)) {
      return blankState();
    }
    return { ...parsed, charges: Array.isArray(parsed.charges) ? parsed.charges : [], chargeRequests: parsed.chargeRequests ?? {} };
  } catch {
    return blankState();
  }
}

export function writeState(state: AppState, filePath = statePath): AppState {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
  return state;
}
