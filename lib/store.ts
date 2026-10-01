import fs from "fs";
import path from "path";
import { demoEmployee, demoTrip } from "./seed";
import type { TripState } from "./types";

const statePath = path.join(process.cwd(), "data", "state.json");

export function blankState(): TripState {
  return {
    connected: false,
    synced: false,
    pricer: null,
    employee: demoEmployee,
    trip: demoTrip,
    events: [],
    charges: [],
  };
}

export function readState(): TripState {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8")) as TripState;
    if (!parsed?.employee || !Array.isArray(parsed.events)) return blankState();
    return parsed;
  } catch {
    return blankState();
  }
}

export function writeState(state: TripState): TripState {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(state, null, 2));
  return state;
}
