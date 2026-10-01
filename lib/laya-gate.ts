import { spawn } from "node:child_process";
import path from "node:path";
import type { DemoPlan, LayaGate } from "./demo-types";

export async function classifyWithLaya(plan: DemoPlan): Promise<{ gates: Record<string, LayaGate>; elapsedMs: number }> {
  const started = Date.now();
  const payload = JSON.stringify({ currency: plan.snapshot.policy.currency, settings: plan.settings, events: plan.events });
  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(path.join(process.cwd(), "laya/.venv/bin/python"), [path.join(process.cwd(), "laya/contextual_gate.py")], { cwd: process.cwd(), stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "", stderr = "";
    const timeout = setTimeout(() => { child.kill(); reject(new Error("Local Laya timed out. Try a smaller calendar.")); }, 60000);
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", () => { clearTimeout(timeout); reject(new Error("Local Laya is not installed. Run ./laya/setup.sh first.")); });
    child.on("close", (code) => { clearTimeout(timeout); if (code === 0) resolve(stdout); else reject(new Error(`Local Laya failed: ${stderr.slice(-500)}`)); });
    child.stdin.on("error", () => undefined);
    child.stdin.end(payload);
  });
  const gates = JSON.parse(output) as Record<string, LayaGate>;
  for (const row of plan.events) {
    const gate = gates[row.event.id];
    if (!gate || !["needs_budget", "no_budget", "needs_review"].includes(gate.rawLabel) || !Number.isFinite(gate.confidence) || Object.values(gate.probabilities).some((value) => !Number.isFinite(value) || value < 0 || value > 1) || Math.abs(Object.values(gate.probabilities).reduce((sum, value) => sum + value, 0) - 1) > 0.001) throw new Error("Local Laya returned invalid classification probabilities.");
  }
  return { gates, elapsedMs: Date.now() - started };
}
