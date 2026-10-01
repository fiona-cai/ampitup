import { NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import month from "@/data/demo/month.json";
import samples from "@/data/demo/samples.json";
import { validateSnapshot } from "@/lib/snapshot-validation";
import { defaultSettings, planWithJev } from "@/lib/jev-conditioned";
import { allocateWithLuna } from "@/lib/luna-allocator";
import { classifyWithLaya } from "@/lib/laya-gate";
import { clearMemory, giveFeedback, previousRun, readMemory, saveRun } from "@/lib/assignment-memory";
import type { DemoRequest } from "@/lib/demo-types";
import { recordings, replayPlan } from "@/lib/demo-recordings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const pending = queue.then(job, job);
  queue = pending.then(() => undefined, () => undefined);
  return pending;
}

function liveAvailable() { return !process.env.VERCEL && fs.existsSync(path.join(process.cwd(), "laya/.venv/bin/python")) && fs.existsSync(path.join(process.cwd(), "laya/models/english/model.safetensors")); }

export async function GET(request: Request) {
  try {
    const available = liveAvailable();
    const params = new URL(request.url).searchParams;
    const snapshot = validateSnapshot(params.get("dataset") === "samples" ? samples : month);
    const prepare = params.has("prepare");
    const settings = prepare && params.get("dataset") !== "samples" ? recordings.standard.settings : defaultSettings(snapshot);
    const history = available ? readMemory().assignments : recordings.standard.history;
    const draft = planWithJev(snapshot, settings, { history });
    draft.execution = { source: available ? "live" : "recorded", liveAvailable: available };
    if (prepare) return NextResponse.json(draft);
    if (!available) return NextResponse.json(replayPlan({ action: "classify" }, false));
    const classification = await classifyWithLaya(draft);
    const plan = planWithJev(snapshot, settings, { history, gates: classification.gates });
    plan.gateModel.elapsedMs = classification.elapsedMs;
    plan.execution = draft.execution;
    return NextResponse.json(plan);
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load demo." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as DemoRequest;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Send a demo request object.");
    const allowedActions = ["preview", "classify", "allocate", "feedback", "clear_memory"];
    if (body.action && !allowedActions.includes(body.action)) throw new Error("Unknown demo action.");
    if (body.execution && !["live", "recorded"].includes(body.execution)) throw new Error("Choose live models or a verified recording.");
    return await enqueue(async () => {
      const available = liveAvailable();
      if (body.execution === "recorded" || (!body.execution && !available)) {
        if (body.snapshot) validateSnapshot(body.snapshot);
        return NextResponse.json(replayPlan(body, available));
      }
      if (!available) throw new Error("Live Laya needs the local Apple GPU. Play the verified run, or start this app on the configured Mac.");
      const snapshot = validateSnapshot(body.snapshot ?? (body.dataset === "samples" ? samples : month));
      const settings = { ...defaultSettings(snapshot), ...body.settings };
      let plan = planWithJev(snapshot, settings, { history: readMemory().assignments, approvals: body.approvals });
      if (body.action === "feedback") {
        if (!body.feedback) throw new Error("Choose an assignment and feedback.");
        giveFeedback(body.feedback.assignmentId, body.feedback.value, body.feedback.actualMinor);
        plan = planWithJev(snapshot, settings, { history: readMemory().assignments, approvals: body.approvals });
      }
      if (body.action === "clear_memory") { clearMemory(); plan = planWithJev(snapshot, settings); }
      if (body.action === "allocate" || body.action === "classify") {
        const previous = body.action === "allocate" && body.runId ? previousRun(body.runId, plan) : undefined;
        if (body.action === "allocate" && body.runId && !previous?.gates) throw new Error("The context changed. Run Jev again before allocating.");
        const classification = previous?.gates ? { gates: previous.gates, elapsedMs: previous.gateElapsedMs ?? 0 } : await classifyWithLaya(plan);
        plan = planWithJev(snapshot, settings, { gates: classification.gates, history: readMemory().assignments });
        plan.gateModel.elapsedMs = classification.elapsedMs;
        plan.execution = { source: "live", liveAvailable: true };
        if (body.action === "classify") {
          plan.runId = saveRun(plan, [], 0, classification.gates, classification.elapsedMs);
          return NextResponse.json(plan);
        }
        const allocation = await allocateWithLuna(plan);
        const historyBefore = readMemory().assignments;
        const runId = saveRun(plan, allocation.quotes, allocation.elapsedMs, classification.gates, classification.elapsedMs);
        const evaluated = planWithJev(snapshot, settings, { quotes: allocation.quotes, history: historyBefore, gates: classification.gates });
        const historyAfter = readMemory().assignments;
        evaluated.history = historyAfter.slice(-15).reverse();
        evaluated.pricing.historyCount = historyAfter.length;
        evaluated.runId = runId;
        evaluated.pricing.elapsedMs = allocation.elapsedMs;
        evaluated.pricing.newAssignments = allocation.quotes.length;
        evaluated.gateModel.elapsedMs = classification.elapsedMs;
        evaluated.execution = plan.execution;
        return NextResponse.json(evaluated);
      }
      if (body.runId) {
        const run = previousRun(body.runId, plan);
        if (run?.gates) {
          const memory = readMemory();
          plan = planWithJev(snapshot, settings, { quotes: run.quotes, history: memory.assignments, approvals: body.approvals, gates: run.gates });
          for (const row of plan.events) row.history = memory.assignments.filter((past) => run.histories?.[row.event.id]?.includes(past.id));
          plan.runId = run.id;
          plan.pricing.elapsedMs = run.elapsedMs;
          plan.gateModel.elapsedMs = run.gateElapsedMs ?? 0;
        }
      }
      if (plan.gateModel.calledEvents === 0) {
        const classification = await classifyWithLaya(plan);
        plan = planWithJev(snapshot, settings, { history: readMemory().assignments, gates: classification.gates, approvals: body.approvals });
        plan.gateModel.elapsedMs = classification.elapsedMs;
      }
      plan.execution = { source: "live", liveAvailable: true };
      return NextResponse.json(plan);
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Demo request failed." }, { status: 400 });
  }
}
