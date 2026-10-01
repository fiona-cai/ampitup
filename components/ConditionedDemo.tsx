"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import type { NormalizedEvent } from "@/lib/budget-protocol";
import type { Assignment, ConditionedEvent, DemoPlan, DemoRequest, DemoSettings } from "@/lib/demo-types";
import { instantInZone } from "@/lib/event-context";

const gateLabels = { no_budget: "No funding", needs_budget: "Definitely needs funding", needs_review: "Dubious" };
const statusLabels = { ready: "Ready for approval", review: "Needs your review", no_budget: "No LLM call needed", unfunded: "Not allocated", approved: "Approved", rejected: "Rejected" };
const dateLabel = (value: string) => new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${value}T12:00:00Z`));
const money = (amount: number, currency = "USD") => new Intl.NumberFormat("en-US", { style: "currency", currency }).format(amount / 100);

export default function ConditionedDemo() {
  const [plan, setPlan] = useState<DemoPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("all");
  const [approvals, setApprovals] = useState<Record<string, "approved" | "rejected">>({});
  const [dataset, setDataset] = useState("month");
  const [notice, setNotice] = useState("");
  const upload = useRef<HTMLInputElement>(null);
  const initial = useRef(false);

  const send = useCallback(async (body: DemoRequest) => {
    setBusy(true); setError(null);
    try {
      const response = await fetch("/api/demo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not evaluate the week.");
      setPlan(data);
      return data as DemoPlan;
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not evaluate the week."); return null; }
    finally { setBusy(false); }
  }, []);

  useEffect(() => {
    if (initial.current) return;
    initial.current = true;
    // The initial demo performs a real model call, not a canned quote replay.
    void fetch("/api/demo").then((response) => response.json()).then((data) => {
      if (data.error) throw new Error(data.error);
      setPlan(data);
      void send({ action: "allocate", dataset: "month" });
    }).catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load the demo."));
  }, [send]);

  const evaluate = (settings: Partial<DemoSettings> = {}, snapshot = plan?.snapshot) => {
    if (!plan || !snapshot) return;
    setNotice(""); setApprovals({});
    return send({ action: "allocate", snapshot, settings: { ...plan.settings, ...settings }, approvals: {} });
  };

  const decide = (eventId: string, value: "approved" | "rejected") => {
    if (!plan) return;
    const next = { ...approvals, [eventId]: value };
    setApprovals(next);
    void send({ action: "preview", snapshot: plan.snapshot, settings: plan.settings, approvals: next, runId: plan.runId });
  };

  const feedback = async (assignmentId: string, value: "too_low" | "appropriate" | "too_high", actualMinor?: number) => {
    if (!plan) return;
    const result = await send({ action: "feedback", snapshot: plan.snapshot, settings: plan.settings, approvals, runId: plan.runId, feedback: { assignmentId, value, actualMinor } });
    if (result) setNotice("Feedback saved. Run the allocator again to use it in the next assignments.");
  };

  const download = () => {
    if (!plan) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(plan, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = `jev-${plan.settings.weekStart}.json`; link.click(); URL.revokeObjectURL(url);
  };

  const groups = new Map<string, ConditionedEvent[]>();
  for (const row of plan?.events ?? []) {
    if (filter !== "all" && row.need !== filter) continue;
    groups.set(row.context.date, [...(groups.get(row.context.date) ?? []), row]);
  }
  const gateCounts = { no_budget: 0, needs_budget: 0, needs_review: 0 };
  for (const row of plan?.events ?? []) gateCounts[row.need]++;

  return <main className="demo-shell">
    <header className="demo-header">
      <Link href="/" className="demo-brand"><span className="demo-monogram">A</span><span>Allot <small>Laya’s weekly plan</small></span></Link>
      <div className="demo-header-actions"><span className="demo-simulated">Simulated calendar & wallet</span><Link href="/classic">Original demo</Link><button onClick={download} disabled={!plan || busy}>Export decisions</button></div>
    </header>
    <div className="demo-intro"><div><h1>Make the week add up.</h1><p>Local Laya decides whether an event needs money. Luna assigns an amount, explains it, and remembers past assignments.</p></div><button className="demo-primary" disabled={busy || !plan} onClick={() => void evaluate()}>{busy ? "Laya + Luna are deciding…" : "Run Laya + Luna again"}</button></div>
    {error && <div className="demo-error" role="alert"><strong>Allocation could not finish.</strong> {error}<button disabled={busy} onClick={() => void send(plan ? { action: "allocate", snapshot: plan.snapshot, settings: plan.settings, approvals } : { action: "allocate", dataset: "month" })}>Retry allocation</button></div>}
    {notice && <p className="demo-notice" role="status">{notice}</p>}
    {!plan ? <section className="demo-loading" role="status"><span className="demo-loading-dot" /><h2>{busy ? "Reading the calendar and calling Luna" : "Your week is waiting"}</h2><p>Checking travel, workload, expense coverage, and available money. The first run uses real model inference and can take about a minute.</p></section> : <>
      <section className="demo-wallet" aria-label="Weekly funding account"><div><span>Available before this plan</span><strong>{money(plan.wallet.availableWeeklyMinor, plan.snapshot.policy.currency)}</strong><small>{money(plan.settings.weeklyLimitMinor, plan.snapshot.policy.currency)} weekly limit − {money(plan.settings.spentWeeklyMinor, plan.snapshot.policy.currency)} already spent</small></div><div><span>Reserved for this plan</span><strong>{money(plan.wallet.plannedMinor, plan.snapshot.policy.currency)}</strong><small>{plan.summary.ready + plan.summary.approved} feasible assignments · {plan.summary.approved} approved</small></div><div className="demo-wallet-remaining"><span>Still available this week</span><strong>{money(plan.wallet.remainingWeeklyMinor, plan.snapshot.policy.currency)}</strong><small>{money(plan.wallet.remainingMonthlyMinor, plan.snapshot.policy.currency)} remaining this month</small></div></section>
      <div className="demo-workspace">
        <aside className="demo-controls">
          <h2>Condition the decision</h2><p>Change the facts, then run the allocator. The money and calendar constraints are real inputs.</p>
          <label>Test data<select value={dataset} disabled={busy} onChange={(event) => { const value = event.target.value; if (value === "custom") return; setDataset(value); setApprovals({}); void send({ action: "allocate", dataset: value as "month" | "samples" }); }}><option value="month">LARP month · 118 events</option><option value="samples">Augmented calendar · 500 events</option>{dataset === "custom" && <option value="custom">Your uploaded snapshot</option>}</select></label>
          <button className="demo-upload" disabled={busy} onClick={() => upload.current?.click()}>Use your own JSON snapshot</button>
          <input ref={upload} type="file" accept=".json,application/json" className="demo-file-input" aria-label="Upload event snapshot" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; try { const snapshot = JSON.parse(await file.text()); const result = await send({ action: "allocate", snapshot }); if (result) { setDataset("custom"); setApprovals({}); } } catch { setError("That file is not valid JSON. Use the standardized v1.0 event snapshot."); } event.target.value = ""; }} />
          <label>Week<select value={plan.settings.weekStart} disabled={busy} onChange={(event) => { setApprovals({}); void send({ action: "allocate", snapshot: plan.snapshot, settings: { ...plan.settings, weekStart: event.target.value }, approvals: {} }); }}>{plan.weeks.map((week) => <option key={week} value={week}>Week of {dateLabel(week)}</option>)}</select></label>
          <div className="demo-presets"><button disabled={busy} onClick={() => void evaluate({ spentWeeklyMinor: Math.max(0, plan.settings.weeklyLimitMinor - 12000), spentMonthlyMinor: Math.max(plan.settings.spentMonthlyMinor, plan.settings.weeklyLimitMinor - 12000) })}>Try a tight week</button><button disabled={busy} onClick={() => void evaluate({ spentWeeklyMinor: 0, spentMonthlyMinor: 0 })}>Reset spending</button></div>
          <WalletForm key={`${plan.settings.weekStart}:${JSON.stringify(plan.settings)}`} settings={plan.settings} currency={plan.snapshot.policy.currency} busy={busy} onApply={(settings) => void evaluate(settings)} />
          <div className="demo-provider"><strong>Gate: local Laya on Apple GPU</strong><span>{plan.gateModel.calledEvents} classifications · {(plan.gateModel.elapsedMs / 1000).toFixed(1)}s</span><strong>Allocator: {plan.pricing.model}</strong><span>{plan.pricing.calledEvents} events sent · {(plan.pricing.elapsedMs / 1000).toFixed(1)}s</span><span>{plan.pricing.historyCount} past assignments in memory</span><small>Luna uses your signed-in Codex CLI. No-funding events skip the LLM entirely.</small></div>
        </aside>
        <section className="demo-calendar" aria-label="Event funding decisions" aria-busy={busy}>
          <div className="demo-calendar-heading"><div><h2>Week of {dateLabel(plan.settings.weekStart)}</h2><p>{plan.events.length} events · {plan.snapshot.subject.homeCity ?? "Home city unknown"} · {plan.snapshot.subject.timeZone}</p></div><button disabled={busy || !plan.events.some((row) => row.status === "ready")} onClick={() => { const next = { ...approvals }; for (const row of plan.events) if (row.status === "ready") next[row.event.id] = "approved"; setApprovals(next); void send({ action: "preview", snapshot: plan.snapshot, settings: plan.settings, approvals: next, runId: plan.runId }); }}>Approve ready assignments</button></div>
          <nav className="demo-filters" aria-label="Filter funding gates">{[["all", "All events", plan.events.length], ["needs_budget", "Definitely needs funding", gateCounts.needs_budget], ["needs_review", "Dubious", gateCounts.needs_review], ["no_budget", "No funding", gateCounts.no_budget]].map(([value, label, count]) => <button key={value} aria-pressed={filter === value} className={filter === value ? "active" : ""} onClick={() => setFilter(String(value))}>{label}<span>{count}</span></button>)}</nav>
          {busy && <p className="demo-working" role="status">Luna is comparing the new context with prior assignments. Previous results remain visible until the new run finishes.</p>}
          {groups.size === 0 && <p className="demo-empty">No events match this gate for the selected week.</p>}
          {[...groups].map(([date, rows]) => <section className="demo-day" key={date}><h3>{new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`))}<span>{(rows[0].context.day.busyMinutes / 60).toFixed(1)} scheduled hours</span></h3>{rows.map((row) => <EventRow key={row.event.id} row={row} currency={plan.snapshot.policy.currency} busy={busy} onDecide={decide} onEdit={(event) => { const snapshot = { ...plan.snapshot, events: plan.snapshot.events.map((item) => item.id === event.id ? event : item) }; void evaluate({}, snapshot); }} />)}</section>)}
        </section>
      </div>
      <section className="demo-memory"><div className="demo-memory-heading"><div><h2>What the allocator remembers</h2><p>Previous proposals help it recognize patterns. Your corrections and actual spending are stronger evidence.</p></div><button disabled={busy || !plan.history.length} onClick={() => void send({ action: "clear_memory", snapshot: plan.snapshot, settings: plan.settings })}>Clear demo history</button></div>{plan.history.length === 0 ? <p>No assignments yet. Run the allocator to start building a history.</p> : <div className="demo-history-list">{plan.history.slice(0, 8).map((assignment) => <HistoryRow key={assignment.id} assignment={assignment} busy={busy} onFeedback={feedback} />)}</div>}<p className="demo-memory-note">This is persistent memory and feedback conditioning, not model weight training. The model’s own proposals are never labeled as successful spending.</p></section>
    </>}
    <footer className="demo-footer">Allot · Local Laya gates, real Luna allocations, synthetic events, and a simulated wallet. Assignments stay within daily, weekly, monthly, and category limits. <a href="https://github.com/fiona-cai/ampitup/tree/main/protocol">JSON contract</a></footer>
  </main>;
}

function WalletForm({ settings, currency, busy, onApply }: { settings: DemoSettings; currency: string; busy: boolean; onApply: (settings: Partial<DemoSettings>) => void }) {
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget); const next: Partial<DemoSettings> = {};
    for (const key of ["weeklyLimitMinor", "spentWeeklyMinor", "dailyLimitMinor", "monthlyLimitMinor", "spentMonthlyMinor"] as const) next[key] = Math.round(Number(data.get(key)) * 100);
    for (const key of ["maxDailyHours", "maxWeeklyHours", "maxEventHours", "maxDifficultyHours"] as const) next[key] = Number(data.get(key));
    onApply(next);
  };
  return <form className="demo-wallet-form" onSubmit={submit}><h3>Available money <span>{currency}</span></h3>{[["weeklyLimitMinor", "Weekly budget"], ["spentWeeklyMinor", "Already spent this week"], ["dailyLimitMinor", "Daily cap"], ["monthlyLimitMinor", "Monthly budget"], ["spentMonthlyMinor", "Already spent this month"]].map(([key, label]) => <label key={key}>{label}<input type="number" name={key} min="0" step="0.01" defaultValue={Number(settings[key as keyof DemoSettings]) / 100} required disabled={busy} /></label>)}<h3>Feasibility limits</h3>{[["maxDailyHours", "Scheduled hours / day"], ["maxWeeklyHours", "Scheduled hours / week"], ["maxEventHours", "Maximum event hours"], ["maxDifficultyHours", "Maximum effort hours / event"]].map(([key, label]) => <label key={key}>{label}<input type="number" name={key} min="0.5" max="168" step="0.5" defaultValue={Number(settings[key as keyof DemoSettings])} required disabled={busy} /></label>)}<button className="demo-primary" type="submit" disabled={busy}>{busy ? "Allocating…" : "Apply context & allocate"}</button></form>;
}

function EventRow({ row, currency, busy, onDecide, onEdit }: { row: ConditionedEvent; currency: string; busy: boolean; onDecide: (id: string, value: "approved" | "rejected") => void; onEdit: (event: NormalizedEvent) => void }) {
  return <article className={`demo-event gate-${row.need}`}><div className="demo-event-top"><div className="demo-event-time">{row.event.schedule.allDay ? "All day" : new Intl.DateTimeFormat("en-US", { timeZone: row.event.schedule.timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(row.event.schedule.start))}<small>{Math.round(row.context.durationMinutes)} min</small></div><div className="demo-event-title"><h4>{row.event.title}</h4><p>{row.event.location.label ?? "Location unknown"} · {row.event.purpose.importance} importance</p><span className={`demo-gate ${row.need}`}>{gateLabels[row.need]}</span></div><div className="demo-event-amount"><strong>{money(row.allocatedMinor || row.proposedMinor, currency)}</strong><small>{row.allocation ? "Luna proposal" : row.need === "no_budget" ? "No allocation" : "Awaiting Luna"}</small></div></div><p className="demo-event-reason">{row.reason}</p><div className="demo-event-bottom"><span className={`demo-result result-${row.status}`}>{statusLabels[row.status]}</span>{row.shortfallMinor > 0 && <span className="demo-shortfall">{money(row.shortfallMinor, currency)} short</span>}{row.allocation && row.need !== "no_budget" && row.proposedMinor > 0 && row.status !== "approved" && row.status !== "rejected" && <button disabled={busy || row.status === "unfunded"} onClick={() => onDecide(row.event.id, "approved")}>{row.need === "needs_review" ? "Approve after review" : "Approve"}</button>}{row.allocation && row.need !== "no_budget" && row.status !== "rejected" && <button disabled={busy} onClick={() => onDecide(row.event.id, "rejected")}>Reject</button>}</div>{row.allocation?.questions.length ? <ul className="demo-questions">{row.allocation.questions.map((question, i) => <li key={i}>{question}</li>)}</ul> : null}<details className="demo-event-details"><summary>Conditions, past patterns & edit event <span>{row.history.length} relevant past assignments</span></summary><dl className="demo-conditions">{row.conditions.map((condition) => <div key={condition.name}><dt>{condition.name}</dt><dd className={`effect-${condition.effect}`}>{condition.value}</dd></div>)}</dl>{row.classifier && <div className="demo-classifier"><strong>Local Laya’s raw decision: {gateLabels[row.classifier.rawLabel]}</strong><p>{Object.entries(row.classifier.probabilities).map(([label, value]) => `${gateLabels[label as keyof typeof gateLabels]} ${(value * 100).toFixed(1)}%`).join(" · ")}</p>{row.classifier.override && <p>Guard: {row.classifier.override}</p>}<small>Model probabilities are estimates, not measured accuracy.</small></div>}{row.history.length > 0 && <div className="demo-event-history"><h5>Comparable assignments</h5>{row.history.map((past) => <p key={past.id}><strong>{past.title}: {money(past.amountMinor, past.currency)}</strong> · {past.actualMinor !== null ? `actual ${money(past.actualMinor, past.currency)}` : "previous proposal only"}{past.feedback && ` · ${past.feedback.replaceAll("_", " ")}`}{row.allocation?.historyIds.includes(past.id) && <span>Used in this rationale</span>}</p>)}</div>}<EventEditor key={JSON.stringify(row.event)} row={row} busy={busy} onEdit={onEdit} /></details></article>;
}

function EventEditor({ row, busy, onEdit }: { row: ConditionedEvent; busy: boolean; onEdit: (event: NormalizedEvent) => void }) {
  const cost = row.event.expenses?.find((line) => line.coverage === "not_covered" || line.coverage === "unknown");
  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const data = new FormData(event.currentTarget); const next = structuredClone(row.event);
    next.title = String(data.get("title"));
    next.purpose.importance = String(data.get("importance")) as typeof next.purpose.importance;
    next.purpose.difficulty = String(data.get("difficulty")) as typeof next.purpose.difficulty;
    next.purpose.scope = String(data.get("scope")) as typeof next.purpose.scope;
    next.attendance = String(data.get("attendance")) as typeof next.attendance;
    next.location.travelFromPreviousMinutes = data.get("travel") === "" ? null : Number(data.get("travel"));
    if (!next.schedule.allDay) next.schedule.end = instantInZone(Date.parse(next.schedule.start) + Number(data.get("duration")) * 60000, next.schedule.timeZone);
    if (data.get("estimate") !== "") {
      const amount = Math.round(Number(data.get("estimate")) * 100);
      const line = { category: String(data.get("category")) as "meal", coverage: String(data.get("coverage")) as "not_covered", estimatedAmountMinor: amount, beneficiaryCount: next.participants.totalCount, notes: "Updated in the simulated demo" };
      if (cost && next.expenses) next.expenses[next.expenses.findIndex((item) => item === cost || (item.category === cost.category && item.coverage === cost.coverage))] = line;
      else next.expenses = [...(next.expenses ?? []), line];
    }
    next.missingFields = []; // Optional pointers; unknown facts themselves remain unchanged.
    onEdit(next);
  };
  return <form className="demo-editor" onSubmit={submit}><h5>Edit the facts and rerun</h5><label className="demo-editor-title">Event title<input name="title" defaultValue={row.event.title} required maxLength={240} disabled={busy} /></label><label>Duration (minutes)<input name="duration" type="number" min="1" max="10080" defaultValue={Math.round(row.context.durationMinutes)} disabled={busy || row.event.schedule.allDay} /></label><label>Importance<select name="importance" defaultValue={row.event.purpose.importance} disabled={busy}>{["low", "normal", "high", "unknown"].map((value) => <option key={value}>{value}</option>)}</select></label><label>Difficulty<select name="difficulty" defaultValue={row.event.purpose.difficulty} disabled={busy}>{["low", "moderate", "high", "unknown"].map((value) => <option key={value}>{value}</option>)}</select></label><label>Purpose<select name="scope" defaultValue={row.event.purpose.scope} disabled={busy}>{["work", "personal", "unknown"].map((value) => <option key={value}>{value}</option>)}</select></label><label>Attendance<select name="attendance" defaultValue={row.event.attendance} disabled={busy}>{["accepted", "tentative", "declined", "unknown"].map((value) => <option key={value}>{value}</option>)}</select></label><label>Travel from previous (min)<input name="travel" type="number" min="0" max="1440" placeholder="Unknown" defaultValue={row.event.location.travelFromPreviousMinutes ?? ""} disabled={busy} /></label><label>Expense estimate<input name="estimate" type="number" min="0" step="0.01" placeholder="Unknown" defaultValue={cost?.estimatedAmountMinor != null ? cost.estimatedAmountMinor / 100 : ""} disabled={busy} /></label><label>Expense category<select name="category" defaultValue={cost?.category ?? "meal"} disabled={busy}>{["meal", "coffee", "transport", "lodging", "admission", "supplies", "other"].map((value) => <option key={value}>{value}</option>)}</select></label><label>Expense coverage<select name="coverage" defaultValue={cost?.coverage ?? "not_covered"} disabled={busy}>{["not_covered", "provided", "prepaid", "unknown"].map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</select></label><button className="demo-primary" type="submit" disabled={busy}>Save event & reallocate</button></form>;
}

function HistoryRow({ assignment, busy, onFeedback }: { assignment: Assignment; busy: boolean; onFeedback: (id: string, value: "too_low" | "appropriate" | "too_high", actualMinor?: number) => void }) {
  const [actual, setActual] = useState(assignment.actualMinor !== null ? String(assignment.actualMinor / 100) : "");
  return <article className="demo-history-row"><div><h3>{assignment.title}<span>{money(assignment.amountMinor, assignment.currency)}</span></h3><p>{assignment.rationale}</p><small>{assignment.category} · {assignment.city ?? "unknown city"} · {assignment.durationMinutes} min · {assignment.feedback?.replaceAll("_", " ") ?? "Unverified model proposal"}</small></div><div className="demo-history-feedback"><div>{[["too_low", "Too low"], ["appropriate", "About right"], ["too_high", "Too high"]].map(([value, label]) => <button key={value} disabled={busy} aria-pressed={assignment.feedback === value} onClick={() => onFeedback(assignment.id, value as "too_low" | "appropriate" | "too_high")}>{label}</button>)}</div><form onSubmit={(event) => { event.preventDefault(); if (actual !== "") onFeedback(assignment.id, assignment.feedback ?? "appropriate", Math.round(Number(actual) * 100)); }}><label>Actual spend<input type="number" min="0" step="0.01" value={actual} onChange={(event) => setActual(event.target.value)} placeholder="Unknown" disabled={busy} /></label><button disabled={busy || actual === ""}>Save actual</button></form></div></article>;
}
