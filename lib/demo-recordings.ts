import records from "@/data/demo/verified-runs.json";
import { planWithJev } from "./jev-conditioned";
import { planFingerprint } from "./assignment-memory";
import type { EventSnapshot } from "./budget-protocol";
import type { Assignment, AllocationQuote, DemoPlan, DemoRequest, DemoSettings, LayaGate } from "./demo-types";

type Recording = { recordedAt: string; snapshot: EventSnapshot; settings: DemoSettings; gates: Record<string, LayaGate>; quotes: AllocationQuote[]; history: Assignment[]; gateElapsedMs: number; elapsedMs: number };
export const recordings = records as unknown as Record<string, Recording>;

/** A replay only accepts the exact facts supplied to the recorded models. */
export function replayPlan(body: DemoRequest, liveAvailable: boolean): DemoPlan {
  if (body.action === "feedback" || body.action === "clear_memory") throw new Error("Recorded runs are read-only. Switch to live models to save feedback.");
  const base = recordings.standard;
  const snapshot = (body.snapshot ?? base.snapshot) as EventSnapshot;
  const settings = { ...base.settings, ...body.settings };
  const draft = planWithJev(snapshot, settings);
  const entry = Object.entries(recordings).find(([, recording]) => planFingerprint(draft) === planFingerprint(planWithJev(recording.snapshot, recording.settings)));
  if (!entry || (body.dataset && body.dataset !== "month")) throw new Error("This context has no verified recording. Use live models, or restore the demo week.");
  const [key, recording] = entry;
  const priced = body.action === "allocate" || (body.action === "preview" && body.runId === `recorded:${key}`);
  const plan = planWithJev(snapshot, settings, { history: recording.history, gates: recording.gates, ...(priced ? { quotes: recording.quotes, approvals: body.approvals } : {}) });
  plan.execution = { source: "recorded", recordedAt: recording.recordedAt, liveAvailable };
  plan.gateModel.elapsedMs = recording.gateElapsedMs;
  if (priced) { plan.runId = `recorded:${key}`; plan.pricing.elapsedMs = recording.elapsedMs; }
  return plan;
}
