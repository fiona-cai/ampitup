"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import RampIcon from "./RampIcon";
import AppDialog from "./AppDialog";
import type { ConditionedEvent, DemoPlan, DemoRequest, DemoSettings } from "@/lib/demo-types";

type Phase = "idle" | "jev" | "sorted" | "luna" | "ready";
const gates = [
  { id: "no_budget", label: "No funding", icon: "check" },
  { id: "needs_budget", label: "Needs funding", icon: "coin" },
  { id: "needs_review", label: "Dubious", icon: "search" },
] as const;
const dollars = (n: number, currency = "USD") => new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: n % 100 ? 2 : 0 }).format(n / 100);
const weekLabel = (d: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${d}T12:00:00Z`));

export default function FundingWorkflow() {
  const [plan, setPlan] = useState<DemoPlan | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [execution, setExecution] = useState<"live" | "recorded">("live");
  const [shown, setShown] = useState<Set<string>>(new Set());
  const [priced, setPriced] = useState<Set<string>>(new Set());
  const [active, setActive] = useState("");
  const [filter, setFilter] = useState("all");
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [contextOpen, setContextOpen] = useState(false);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [approvals, setApprovals] = useState<Record<string, "approved" | "rejected">>({});
  const [saving, setSaving] = useState(false);
  const [dataset, setDataset] = useState("month");
  const uploadRef = useRef<HTMLInputElement>(null);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const locked = useRef(false);
  const busy = phase === "jev" || phase === "luna" || saving;

  const load = useCallback(async (source = "month") => {
    const response = await fetch(`/api/demo?prepare=1&dataset=${source}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load the calendar.");
    return data as DemoPlan;
  }, []);
  useEffect(() => {
    let cancelled = false;
    const lifecycle = { generation, controller };
    void load().then((data) => { if (!cancelled) { setPlan(data); setExecution(data.execution?.source ?? "live"); } }).catch((e) => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; lifecycle.generation.current++; lifecycle.controller.current?.abort(); };
  }, [load]);

  const send = async (body: DemoRequest) => {
    controller.current = new AbortController();
    const response = await fetch("/api/demo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...body, execution }), signal: controller.current.signal });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not finish this run.");
    return data as DemoPlan;
  };
  const reveal = async (rows: ConditionedEvent[], stage: "jev" | "luna", token: number) => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const delay = reduced ? 0 : Math.min(stage === "jev" ? 90 : 145, 2600 / Math.max(1, rows.length));
    const ids = new Set<string>();
    for (const row of rows) {
      if (generation.current !== token) return;
      setActive(row.event.title); ids.add(row.event.id);
      if (stage === "jev") setShown(new Set(ids)); else setPriced(new Set(ids));
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    }
    setActive("");
  };
  async function runJev(settings: DemoSettings | null = plan?.settings ?? null, snapshot = plan?.snapshot) {
    if (!plan || !snapshot || locked.current) return;
    locked.current = true; const token = ++generation.current;
    setError(""); setNotice(""); setShown(new Set()); setPriced(new Set()); setApprovals({}); setFilter("all"); setPhase("jev"); setActive("Reading the calendar");
    try {
      const data = await send({ action: "classify", snapshot, settings: settings ?? undefined });
      if (generation.current !== token) return;
      setPlan(data); await reveal(data.events, "jev", token);
      if (generation.current === token) setPhase("sorted");
    } catch (e) { if (generation.current === token) { setError(e instanceof Error ? e.message : "Jev could not finish. Try again."); setPhase("idle"); setActive(""); } }
    finally { locked.current = false; }
  }
  async function runLuna() {
    if (!plan || locked.current) return;
    locked.current = true; const token = ++generation.current;
    setError(""); setPhase("luna"); setActive("Comparing costs and previous assignments"); setPriced(new Set());
    try {
      const data = await send({ action: "allocate", snapshot: plan.snapshot, settings: plan.settings, runId: plan.runId });
      if (generation.current !== token) return;
      setPlan(data); const candidates = data.events.filter((r) => r.need !== "no_budget");
      await reveal(candidates, "luna", token);
      if (generation.current === token) { setPhase("ready"); setFilter("funding"); }
    } catch (e) { if (generation.current === token) { setError(e instanceof Error ? e.message : "Luna could not finish. Try again."); setPhase("sorted"); setActive(""); } }
    finally { locked.current = false; }
  }
  async function reset(mode = execution) {
    if (locked.current || saving) return;
    setSaving(true); setError("");
    try { const data = await load(); setPlan(data); setDataset("month"); setExecution(mode); setPhase("idle"); setShown(new Set()); setPriced(new Set()); setActive(""); setFilter("all"); setApprovals({}); setNotice(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not reset. Try again."); }
    finally { setSaving(false); }
  }
  async function decide(id: string, value: "approved" | "rejected") {
    if (!plan || busy) return;
    setSaving(true); const next = { ...approvals, [id]: value }; setError("");
    try { const data = await send({ action: "preview", snapshot: plan.snapshot, settings: plan.settings, runId: plan.runId, approvals: next }); setPlan(data); setApprovals(next); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save the review."); }
    finally { setSaving(false); }
  }
  async function feedback(assignmentId: string, value: "too_low" | "appropriate" | "too_high", actualMinor?: number) {
    if (!plan || busy) return;
    setSaving(true); setError("");
    try { setPlan(await send({ action: "feedback", snapshot: plan.snapshot, settings: plan.settings, runId: plan.runId, approvals, feedback: { assignmentId, value, actualMinor } })); setNotice("Feedback saved. The next run will use it."); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not save feedback."); }
    finally { setSaving(false); }
  }
  function exportPlan() {
    if (!plan) return;
    const blob = new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = "allot-decisions.json"; a.click(); URL.revokeObjectURL(url);
  }
  const sorted = phase !== "idle" && phase !== "jev";
  const rows = (plan?.events ?? []).filter((row) => {
    if (filter === "funding" && (row.need === "no_budget" || !shown.has(row.event.id))) return false;
    if (!["all", "funding"].includes(filter) && (row.need !== filter || !shown.has(row.event.id))) return false;
    return `${row.event.title} ${row.event.location.label ?? ""}`.toLowerCase().includes(query.toLowerCase());
  });
  const candidates = plan?.events.filter((row) => row.need !== "no_budget").length ?? 0;
  const detail = plan?.events.find((r) => r.event.id === detailId);
  const currency = plan?.snapshot.policy.currency ?? "USD";
  const remaining = phase === "ready" ? plan?.wallet.remainingWeeklyMinor : plan?.wallet.availableWeeklyMinor;

  return <div className="funding-workflow">
    <div className="funding-toolbar"><div className="funding-source"><RampIcon name="calendar" /><span>{dataset === "samples" ? "500 sample events" : dataset === "custom" ? "Your JSON snapshot" : "LARP calendar"}</span>{plan && <span className="funding-week">Week of {weekLabel(plan.settings.weekStart)}</span>}</div><div className="funding-tools"><select aria-label="Model execution" value={execution} disabled={busy} onChange={(e) => void reset(e.target.value as "live" | "recorded")}><option value="live" disabled={plan?.execution?.liveAvailable === false}>Live models</option><option value="recorded">Verified replay</option></select><button className="secondary-button" disabled={busy || !plan} onClick={() => setContextOpen(true)}><RampIcon name="settings" /> Context</button><button className="icon-button" aria-label="Reset pipeline" disabled={busy || !plan} onClick={() => void reset()}><RampIcon name="refresh" /></button></div></div>
    {error && <div className="funding-error" role="alert"><span>{error}</span>{execution === "live" && <button className="undo" disabled={busy} onClick={() => void reset("recorded")}>Use verified replay</button>}</div>}
    {notice && <div className="funding-notice" role="status">{notice}</div>}
    <section className="funding-stage" aria-label="Jev and Luna funding pipeline">
      <div className="funding-stage-top"><div className="funding-steps"><span className={phase === "jev" ? "current" : sorted ? "complete" : "current"}><i>{sorted ? <RampIcon name="check" size={12} /> : "1"}</i> Jev sorts</span><RampIcon name="arrow" size={15} /><span className={phase === "luna" ? "current" : phase === "ready" ? "complete" : ""}><i>{phase === "ready" ? <RampIcon name="check" size={12} /> : "2"}</i> Luna funds</span></div><span className="funding-mode"><span className={execution === "live" ? "live-dot" : "replay-dot"} />{execution === "live" ? "Laya + Luna · Live" : "Recorded model run"}</span></div>
      <div className="funding-stage-body"><div className={`agent-scene${busy ? " is-working" : ""}${phase === "luna" ? " is-luna" : ""}`} aria-hidden="true"><div className="event-stack"><span /><span /><span><RampIcon name="calendar" size={19} /></span></div>{busy && <div className="eaten-ticket"><RampIcon name={phase === "luna" ? "coin" : "calendar"} size={15} /></div>}<div className={`little-agent ${phase === "luna" || phase === "ready" ? "agent-luna" : "agent-jev"}`}><span className="agent-eyes"><i /><i /></span><span className="agent-mouth" /><span className="agent-cheek cheek-left" /><span className="agent-cheek cheek-right" /></div><div className="agent-output"><span /><span /><span /></div></div>
        <div className="funding-stage-copy"><h2>{!plan ? "Loading your week…" : phase === "idle" ? "Feed the week to Jev." : phase === "jev" ? "A little context. A lot of sorting." : phase === "sorted" ? "Sorted. Luna takes it from here." : phase === "luna" ? "Luna is making the money add up." : "A budget for the moments that need it."}</h2><p role="status" aria-live="polite">{phase === "idle" ? `${plan?.events.length ?? "Your"} events. Three categories. No blanket allowance.` : phase === "jev" ? (shown.size ? `${shown.size} of ${plan?.events.length} sorted · ${active}` : "Laya is reading the event facts") : phase === "sorted" ? `${candidates} events need a closer look. The rest skip the LLM.` : phase === "luna" ? (priced.size ? `${priced.size} of ${candidates} priced · ${active}` : active) : `${plan?.summary.ready ?? 0} ready to approve · ${plan?.summary.review ?? 0} need your review`}</p></div>
        <button className="primary-button funding-run" disabled={busy || !plan || (phase === "sorted" && candidates === 0)} onClick={() => phase === "sorted" ? void runLuna() : void runJev()}>{busy ? <><span className="funding-spinner" />{phase === "jev" ? "Sorting…" : "Pricing…"}</> : phase === "sorted" ? <><RampIcon name="moon" />Run Luna <span>{candidates}</span></> : phase === "ready" ? <><RampIcon name="refresh" />Run again</> : <>Run Jev <RampIcon name="arrow" /></>}</button>
      </div>
      <div className="funding-wallet"><span>Available this week <strong>{dollars(plan?.wallet.availableWeeklyMinor ?? 0, currency)}</strong></span><span>Reserved <strong>{dollars(phase === "ready" ? plan?.wallet.plannedMinor ?? 0 : 0, currency)}</strong></span><span>Remaining <strong>{dollars(remaining ?? 0, currency)}</strong></span><button className="undo" disabled={busy || !plan} onClick={() => { if (!plan) return; void runJev({ ...plan.settings, spentWeeklyMinor: Math.max(0, plan.settings.weeklyLimitMinor - 12000), spentMonthlyMinor: Math.max(plan.settings.spentMonthlyMinor, plan.settings.weeklyLimitMinor - 12000) }); }}>Try a $120 week</button></div>
    </section>
    <nav className="funding-bins" aria-label="Funding categories">{gates.map((gate) => { const matching = plan?.events.filter((r) => shown.has(r.event.id) && r.need === gate.id) ?? []; return <button key={gate.id} className={`funding-bin bin-${gate.id}${filter === gate.id ? " selected" : ""}`} disabled={!sorted} aria-pressed={filter === gate.id} onClick={() => setFilter(filter === gate.id ? "all" : gate.id)}><div><RampIcon name={gate.icon} size={17} /><span>{gate.label}</span><RampIcon name="arrow" size={15} /></div><strong>{shown.size ? matching.length : "—"}</strong><span className="bin-caption">{phase === "ready" && gate.id !== "no_budget" ? `${dollars(matching.reduce((s, r) => s + (r.allocatedMinor || r.proposedMinor), 0), currency)} ${gate.id === "needs_review" ? "proposed · not reserved" : "reserved"}` : gate.id === "no_budget" ? "Skips Luna" : gate.id === "needs_budget" ? "Goes to Luna" : "Luna takes a closer look"}</span></button>; })}</nav>
    <div className="funding-table-toolbar"><div><button className={`funding-view${filter === "all" ? " active" : ""}`} onClick={() => setFilter("all")}>All events <span>{plan?.events.length ?? 0}</span></button><button className={`funding-view${filter === "funding" ? " active" : ""}`} disabled={!sorted} onClick={() => setFilter("funding")}>Funding candidates <span>{sorted ? candidates : "—"}</span></button></div><label className="search-box"><RampIcon name="search" size={14} /><input aria-label="Search pipeline events" placeholder="Search events" value={query} onChange={(e) => setQuery(e.target.value)} /></label></div>
    <div className="funding-table-scroll"><table className="funding-table"><thead><tr><th>Event</th><th>When</th><th>Jev’s decision</th><th>Budget</th><th>Status</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>{rows.map((row) => { const classified = shown.has(row.event.id); const quoteVisible = priced.has(row.event.id); return <tr key={row.event.id} className={classified ? `sorted-row gate-${row.need}` : ""}><td><button className="funding-event-name" onClick={() => setDetailId(row.event.id)}><span className={`funding-event-icon${row.need === "no_budget" && classified ? " muted-icon" : ""}`}><RampIcon name={row.event.expenses?.some((e) => e.category === "transport") ? "briefcase" : "calendar"} size={15} /></span><span>{row.event.title}<small>{row.event.location.label ?? "Location unknown"}</small></span></button></td><td className="funding-time">{new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: plan!.snapshot.subject.timeZone }).format(new Date(row.event.schedule.start))}<small>{Math.round(row.context.durationMinutes)} min</small></td><td>{classified ? <span className={`funding-gate gate-${row.need}`}>{gates.find((g) => g.id === row.need)?.label}</span> : <span className="funding-pending">Waiting for Jev</span>}</td><td className="funding-amount">{classified && row.need === "no_budget" ? "—" : quoteVisible ? dollars(row.allocatedMinor || row.proposedMinor, currency) : phase === "luna" && classified ? <span className="amount-loading" /> : "—"}</td><td><span className={`funding-status status-${quoteVisible ? row.status : "pending"}`}>{!classified ? "Unsorted" : row.need === "no_budget" ? "No allocation" : !quoteVisible ? "Waiting for Luna" : row.status === "approved" ? "Approved" : row.status === "ready" ? "Ready to approve" : row.status === "rejected" ? "Rejected" : row.status === "unfunded" ? "Unfunded" : "Review"}</span></td><td><button className="icon-button" aria-label={`Details for ${row.event.title}`} onClick={() => setDetailId(row.event.id)}><RampIcon name="arrow" size={15} /></button></td></tr>; })}{!rows.length && <tr><td colSpan={6} className="empty-state">{plan ? "No events in this view." : "Loading calendar…"}</td></tr>}</tbody></table></div>
    <footer className="funding-footer"><span>{rows.length} of {plan?.events.length ?? 0} events · Simulated wallet{execution === "recorded" && " · Verified replay"}</span><div><Link href="/harness">Advanced harness</Link><button className="undo" disabled={!plan || busy} onClick={exportPlan}>Export JSON</button></div></footer>
    {contextOpen && plan && <AppDialog title="Condition the week" drawer onClose={() => setContextOpen(false)}><p className="funding-detail-intro">Money, time, and the facts behind each event.</p><form className="funding-context-form" onSubmit={(e) => { e.preventDefault(); const form = new FormData(e.currentTarget); const settings = { ...plan.settings }; for (const k of ["weeklyLimitMinor", "spentWeeklyMinor", "dailyLimitMinor", "monthlyLimitMinor", "spentMonthlyMinor"] as const) settings[k] = Math.round(Number(form.get(k)) * 100); for (const k of ["maxDailyHours", "maxWeeklyHours"] as const) settings[k] = Number(form.get(k)); settings.weekStart = String(form.get("weekStart")); setContextOpen(false); void runJev(settings); }}><label>Week<select name="weekStart" defaultValue={plan.settings.weekStart} disabled={execution === "recorded"}>{plan.weeks.map((week) => <option value={week} key={week}>Week of {weekLabel(week)}</option>)}</select></label>{[["weeklyLimitMinor", "Weekly budget"], ["spentWeeklyMinor", "Already spent this week"], ["dailyLimitMinor", "Daily cap"], ["monthlyLimitMinor", "Monthly budget"], ["spentMonthlyMinor", "Already spent this month"]].map(([key, label]) => <label key={key}>{label}<input name={key} type="number" step="0.01" min="0" required defaultValue={Number(plan.settings[key as keyof DemoSettings]) / 100} disabled={execution === "recorded"} /></label>)}<div className="funding-form-pair">{[["maxDailyHours", "Hours / day"], ["maxWeeklyHours", "Hours / week"]].map(([key, label]) => <label key={key}>{label}<input name={key} type="number" min="0.5" max="168" step="0.5" required defaultValue={Number(plan.settings[key as keyof DemoSettings])} disabled={execution === "recorded"} /></label>)}</div><button className="primary-button" disabled={busy || execution === "recorded"}>Apply & run Jev</button></form><section className="funding-detail-section"><h3>Test data</h3><div className="funding-data-buttons"><button className="secondary-button" disabled={busy || execution === "recorded"} onClick={async () => { try { const data = await load(dataset === "samples" ? "month" : "samples"); setPlan(data); setDataset(dataset === "samples" ? "month" : "samples"); setPhase("idle"); setShown(new Set()); setPriced(new Set()); setContextOpen(false); } catch (e) { setError(e instanceof Error ? e.message : "Could not load samples."); } }}>{dataset === "samples" ? "LARP month" : "500 generated samples"}</button><button className="secondary-button" disabled={busy || execution === "recorded"} onClick={() => uploadRef.current?.click()}>Upload JSON</button></div><input ref={uploadRef} className="demo-file-input" type="file" accept="application/json,.json" aria-label="Upload pipeline snapshot" onChange={async (e) => { const file = e.target.files?.[0]; if (!file) return; try { const snapshot = JSON.parse(await file.text()); setContextOpen(false); setDataset("custom"); await runJev(null, snapshot); } catch { setError("Use a valid v1.0 JSON snapshot."); } }} />{execution === "recorded" && <p>Replay uses the exact recorded context. Switch to live models to change it.</p>}</section><section className="funding-detail-section"><h3>Models</h3><p>Jev uses local Laya. Luna uses gpt-6-luna. No-funding events never reach Luna.</p><p>History and actual-spend feedback condition the next run.</p></section></AppDialog>}
    {detail && plan && <FundingDetail row={detail} plan={plan} classified={shown.has(detail.event.id)} priced={priced.has(detail.event.id)} busy={busy} replay={execution === "recorded"} onClose={() => setDetailId(null)} onDecide={decide} onFeedback={feedback} />}
  </div>;
}

function FundingDetail({ row, plan, classified, priced, busy, replay, onClose, onDecide, onFeedback }: { row: ConditionedEvent; plan: DemoPlan; classified: boolean; priced: boolean; busy: boolean; replay: boolean; onClose: () => void; onDecide: (id: string, value: "approved" | "rejected") => Promise<void>; onFeedback: (id: string, value: "too_low" | "appropriate" | "too_high", actualMinor?: number) => Promise<void> }) {
  const assignment = plan.history.find((a) => a.eventId === row.event.id);
  const [actual, setActual] = useState("");
  const currency = plan.snapshot.policy.currency;
  return <AppDialog title={row.event.title} drawer onClose={onClose}><div className="funding-detail-budget"><strong>{priced ? dollars(row.allocatedMinor || row.proposedMinor, currency) : "—"}</strong><span>{classified ? gates.find((g) => g.id === row.need)?.label : "Waiting for Jev"}</span></div><section className="funding-detail-section"><h3>{priced ? "Why Luna chose this" : "Event context"}</h3><p>{priced ? row.allocation?.rationale : classified ? row.reason.replace(" Run the LLM allocator for an amount and rationale.", "") : "Run Jev to classify this event."}</p>{priced && row.shortfallMinor > 0 && <p>{dollars(row.shortfallMinor, currency)} above the remaining balance.</p>}{row.allocation?.questions.map((q) => <p key={q}>{q}</p>)}{priced && row.proposedMinor > 0 && row.status !== "unfunded" && <div className="form-actions"><button className="primary-button" disabled={busy || row.status === "approved"} onClick={() => void onDecide(row.event.id, "approved")}>{row.status === "approved" ? "Approved" : row.need === "needs_review" ? "Approve after review" : "Approve budget"}</button><button className="secondary-button" disabled={busy || row.status === "rejected"} onClick={() => void onDecide(row.event.id, "rejected")}>Reject</button></div>}</section><section className="funding-detail-section"><h3>What went into the decision</h3><dl className="funding-facts">{row.conditions.map((c) => <div key={c.name}><dt>{c.name}</dt><dd>{c.value}</dd></div>)}</dl></section>{classified && row.classifier && <details className="funding-model-details"><summary>Laya’s prediction</summary><p>{Object.entries(row.classifier.probabilities).map(([k, v]) => `${gates.find((g) => g.id === k)?.label} ${(v * 100).toFixed(0)}%`).join(" · ")}</p>{row.classifier.override && <p>{row.classifier.override}</p>}</details>}{row.history.length > 0 && <section className="funding-detail-section"><h3>Past patterns</h3>{row.history.slice(0, 3).map((past) => <div className="funding-past" key={past.id}><span>{past.title}</span><strong>{dollars(past.amountMinor, currency)}{past.actualMinor !== null && ` → ${dollars(past.actualMinor, currency)} actual`}</strong><small>{past.feedback?.replaceAll("_", " ") ?? "Unverified proposal"}{row.allocation?.historyIds.includes(past.id) && " · Used by Luna"}</small></div>)}</section>}{priced && assignment && <section className="funding-detail-section"><h3>Teach the next run</h3><div className="funding-feedback">{[["too_low", "Too low"], ["appropriate", "About right"], ["too_high", "Too high"]].map(([value, label]) => <button key={value} className="secondary-button" aria-pressed={assignment.feedback === value} disabled={busy || replay} onClick={() => void onFeedback(assignment.id, value as "too_low" | "appropriate" | "too_high")}>{label}</button>)}</div><form className="funding-actual-form" onSubmit={(e) => { e.preventDefault(); if (actual !== "") void onFeedback(assignment.id, assignment.feedback ?? "appropriate", Math.round(Number(actual) * 100)); }}><label>Actual spend<input aria-label="Actual spending" type="number" min="0" step="0.01" value={actual} onChange={(e) => setActual(e.target.value)} placeholder="0.00" disabled={busy || replay} /></label><button className="secondary-button" disabled={busy || replay || actual === ""}>Save</button></form>{replay && <p>Replay is read-only. Use live models to record feedback.</p>}</section>}</AppDialog>;
}
