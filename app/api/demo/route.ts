import { NextResponse } from "next/server";
import month from "@/data/demo/month.json";
import samples from "@/data/demo/samples.json";
import { validateSnapshot } from "@/lib/snapshot-validation";
import { defaultSettings, planWithJev } from "@/lib/jev-conditioned";
import { allocateWithLuna } from "@/lib/luna-allocator";
import { classifyWithLaya } from "@/lib/laya-gate";
import { clearMemory, giveFeedback, previousRun, readMemory, saveRun } from "@/lib/assignment-memory";
import type { DemoRequest } from "@/lib/demo-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

let queue: Promise<unknown> = Promise.resolve();
function enqueue<T>(job: () => Promise<T>): Promise<T> {
  const pending = queue.then(job, job);
  queue = pending.then(() => undefined, () => undefined);
  return pending;
}

export async function GET() {
  try {
    const snapshot = validateSnapshot(month);
    const settings = defaultSettings(snapshot), history = readMemory().assignments;
    const draft = planWithJev(snapshot, settings, { history });
    const classification = await classifyWithLaya(draft);
    const plan = planWithJev(snapshot, settings, { history, gates: classification.gates });
    plan.gateModel.elapsedMs = classification.elapsedMs;
    return NextResponse.json(plan);
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load demo." }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const body = await request.json() as DemoRequest;
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Send a demo request object.");
    const allowedActions = ["preview", "allocate", "feedback", "clear_memory"];
    if (body.action && !allowedActions.includes(body.action)) throw new Error("Unknown demo action.");
    return await enqueue(async () => {
      const snapshot = validateSnapshot(body.snapshot ?? (body.dataset === "samples" ? samples : month));
      const settings = { ...defaultSettings(snapshot), ...body.settings };
      let plan = planWithJev(snapshot, settings, { history: readMemory().assignments, approvals: body.approvals });
      if (body.action === "feedback") {
        if (!body.feedback) throw new Error("Choose an assignment and feedback.");
        giveFeedback(body.feedback.assignmentId, body.feedback.value, body.feedback.actualMinor);
        plan = planWithJev(snapshot, settings, { history: readMemory().assignments, approvals: body.approvals });
      }
      if (body.action === "clear_memory") { clearMemory(); plan = planWithJev(snapshot, settings); }
      if (body.action === "allocate") {
        const classification = await classifyWithLaya(plan);
        plan = planWithJev(snapshot, settings, { gates: classification.gates, history: readMemory().assignments });
        plan.gateModel.elapsedMs = classification.elapsedMs;
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
      return NextResponse.json(plan);
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Demo request failed." }, { status: 400 });
  }
}
