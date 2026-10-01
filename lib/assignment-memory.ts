import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { AllocationQuote, Assignment, DemoPlan, LayaGate } from "./demo-types";

type AllocationRun = { id: string; fingerprint: string; quotes: AllocationQuote[]; elapsedMs: number; gates?: Record<string, LayaGate>; gateElapsedMs?: number; histories?: Record<string, string[]> };
type Memory = { version: 1; assignments: Assignment[]; runs: AllocationRun[] };
const memoryPath = path.join(process.cwd(), "data/jev-memory.json");

export function readMemory(): Memory {
  try {
    const memory = JSON.parse(fs.readFileSync(memoryPath, "utf8")) as Memory;
    if (memory.version !== 1 || !Array.isArray(memory.assignments) || !Array.isArray(memory.runs)) throw new Error("Invalid memory");
    return memory;
  } catch { return { version: 1, assignments: [], runs: [] }; }
}

function writeMemory(memory: Memory) {
  fs.mkdirSync(path.dirname(memoryPath), { recursive: true });
  const temporary = `${memoryPath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(memory, null, 2));
  fs.renameSync(temporary, memoryPath);
}

export function planFingerprint(plan: DemoPlan): string {
  return createHash("sha256").update(JSON.stringify({ snapshot: plan.snapshot, settings: plan.settings })).digest("hex");
}

export function saveRun(plan: DemoPlan, quotes: AllocationQuote[], elapsedMs: number, gates?: Record<string, LayaGate>, gateElapsedMs = 0): string {
  const memory = readMemory();
  const id = randomUUID();
  const createdAt = new Date().toISOString();
  const assignments = quotes.map((quote): Assignment => {
    const row = plan.events.find((item) => item.event.id === quote.eventId)!;
    return { id: randomUUID(), eventId: row.event.id, title: row.event.title, createdAt, currency: plan.snapshot.policy.currency, category: quote.lineItems[0]?.category ?? row.lineItems[0]?.category ?? "other", city: row.event.location.city, importance: row.event.purpose.importance, durationMinutes: row.context.durationMinutes, participants: row.event.participants.totalCount, amountMinor: quote.amountMinor, rationale: quote.rationale, source: "gpt-6-luna", feedback: null, actualMinor: null };
  });
  memory.assignments = [...memory.assignments, ...assignments].slice(-500);
  memory.runs = [...memory.runs, { id, fingerprint: planFingerprint(plan), quotes, elapsedMs, gates, gateElapsedMs, histories: Object.fromEntries(plan.events.map((row) => [row.event.id, row.history.map((past) => past.id)])) }].slice(-30);
  writeMemory(memory);
  return id;
}

export function previousRun(id: string, plan: DemoPlan): AllocationRun | undefined {
  const run = readMemory().runs.find((entry) => entry.id === id);
  if (!run || run.fingerprint !== planFingerprint(plan)) return undefined;
  return run;
}

export function giveFeedback(id: string, value: Assignment["feedback"], actualMinor?: number): void {
  if (!["too_low", "appropriate", "too_high"].includes(value ?? "")) throw new Error("Choose a valid assignment feedback value.");
  if (actualMinor !== undefined && (!Number.isSafeInteger(actualMinor) || actualMinor < 0 || actualMinor > 100000000)) throw new Error("Actual spending must be a nonnegative amount in minor currency units.");
  const memory = readMemory();
  const assignment = memory.assignments.find((entry) => entry.id === id);
  if (!assignment) throw new Error("That assignment is no longer in memory.");
  assignment.feedback = value;
  if (actualMinor !== undefined) assignment.actualMinor = actualMinor;
  writeMemory(memory);
}

export function clearMemory(): void { writeMemory({ version: 1, assignments: [], runs: [] }); }
