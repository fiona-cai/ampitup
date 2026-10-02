"use client";

import { useEffect, useRef, useState } from "react";
import RampIcon from "./RampIcon";
import { formatMoney, formatRange } from "@/lib/time";
import { pipelineGate, type PipelineGate } from "@/lib/ui-events";
import type { AppResponse, PricedEvent } from "@/lib/types";
import type { SendAction } from "./RampAllotApp";

type Phase = "idle" | "jev" | "sorted" | "pricing" | "ready";
const gates = [
  { id: "no_budget", label: "No funding", icon: "check" },
  { id: "needs_budget", label: "Needs funding", icon: "coin" },
  { id: "needs_review", label: "Dubious", icon: "search" },
] as const;

function minutes(item: PricedEvent): number {
  return Math.max(0, Math.round((Date.parse(item.event.end) - Date.parse(item.event.start)) / 60_000));
}

function when(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "short", hour: "numeric", minute: "2-digit", timeZone: "America/New_York" }).format(new Date(iso));
}

function rowStatus(item: PricedEvent, gate: PipelineGate): { label: string; tone: string } {
  if (gate === "no_budget") return { label: "No allocation", tone: "pending" };
  if (item.approval === "approved") return { label: "Approved", tone: "approved" };
  if (item.approval === "rejected") return { label: "Rejected", tone: "rejected" };
  return gate === "needs_review" ? { label: "Review", tone: "review" } : { label: "Ready to approve", tone: "ready" };
}

export default function CalendarPipeline({ state, busy, send, onOpen, onAnnounce }: {
  state: AppResponse; busy: boolean; send: SendAction; onOpen: (id: string) => void; onAnnounce: (message: string) => void;
}) {
  const decided = state.events.some((item) => item.approval !== "pending");
  const allIds = () => new Set(state.events.map((item) => item.event.id));
  const [phase, setPhase] = useState<Phase>(decided ? "ready" : "idle");
  const [shown, setShown] = useState<Set<string>>(() => (decided ? allIds() : new Set()));
  const [priced, setPriced] = useState<Set<string>>(() => (decided ? allIds() : new Set()));
  const [active, setActive] = useState("");
  const [filter, setFilter] = useState<"all" | "funding" | PipelineGate>("all");
  const [query, setQuery] = useState("");
  const generation = useRef(0);
  useEffect(() => () => { generation.current++; }, []);

  const events = state.events;
  const working = phase === "jev" || phase === "pricing";
  const sorted = phase !== "idle" && phase !== "jev";
  const candidates = events.filter((item) => pipelineGate(item) !== "no_budget");
  const pricerName = state.pricer === "claude" || state.pricer === "mixed" ? "Claude" : "Policy";
  const proposed = candidates.reduce((sum, item) => sum + (item.budget?.amount ?? 0), 0);
  const approved = events.reduce((sum, item) => sum + (item.approval === "approved" ? item.budget?.amount ?? 0 : 0), 0);
  const ready = candidates.filter((item) => item.approval === "pending" && pipelineGate(item) === "needs_budget").length;
  const review = candidates.filter((item) => item.approval === "pending" && pipelineGate(item) === "needs_review").length;

  async function reveal(rows: PricedEvent[], stage: "jev" | "pricing", token: number) {
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
  }

  async function runJev() {
    const token = ++generation.current;
    setShown(new Set()); setPriced(new Set()); setFilter("all"); setPhase("jev"); setActive("Reading your Google Calendar");
    const data = await send({ action: "sync" });
    if (generation.current !== token) return;
    if (!data) { setPhase("idle"); setActive(""); return; }
    await reveal(data.events, "jev", token);
    if (generation.current === token) setPhase("sorted");
  }

  async function runPricing() {
    const token = ++generation.current;
    setPhase("pricing"); setPriced(new Set()); setActive(pricerName === "Claude" ? "Claude is pricing each event" : "Applying policy rates");
    await reveal(candidates, "pricing", token);
    if (generation.current === token) { setPhase("ready"); setFilter("funding"); }
  }

  async function approveAll() {
    if (await send({ action: "decide", all: true })) onAnnounce("All event budgets approved.");
  }

  const rows = events.filter((item) => {
    const gate = pipelineGate(item);
    if (filter === "funding" && (gate === "no_budget" || !shown.has(item.event.id))) return false;
    if (filter !== "all" && filter !== "funding" && (gate !== filter || !shown.has(item.event.id))) return false;
    return `${item.event.title} ${item.event.location}`.toLowerCase().includes(query.toLowerCase());
  });

  const headline = !state.synced ? "Reading your Google Calendar…"
    : !events.length ? "Nothing on your calendar this week."
    : phase === "idle" ? "Feed the week to Jev."
    : phase === "jev" ? "A little context. A lot of sorting."
    : phase === "sorted" ? `Sorted. ${pricerName} takes it from here.`
    : phase === "pricing" ? "Making the money add up."
    : "A budget for the moments that need it.";
  const caption = !state.synced ? "This takes a few seconds."
    : !events.length ? (state.sourceNote ?? "No events in the next 7 days.")
    : phase === "idle" ? `${events.length} events from Google Calendar. Three categories. No blanket allowance.`
    : phase === "jev" ? (shown.size ? `${shown.size} of ${events.length} sorted · ${active}` : active)
    : phase === "sorted" ? `${candidates.length} events need money. The rest skip pricing.`
    : phase === "pricing" ? (priced.size ? `${priced.size} of ${candidates.length} priced · ${active}` : active)
    : `${ready} ready to approve · ${review} need your review`;

  return <div className="funding-workflow">
    <div className="funding-toolbar">
      <div className="funding-source"><RampIcon name="calendar" /><span>Google Calendar · {state.employee.email}</span><span className="funding-week">{formatRange(state.window.start, state.window.end)}</span></div>
      <div className="funding-tools"><button className="icon-button" aria-label="Re-read calendar and sort again" disabled={busy || working} onClick={() => void runJev()}><RampIcon name="refresh" /></button></div>
    </div>
    <section className="funding-stage" aria-label="Jev funding pipeline">
      <div className="funding-stage-top">
        <div className="funding-steps">
          <span className={phase === "jev" || phase === "idle" ? "current" : "complete"}><i>{sorted ? <RampIcon name="check" size={12} /> : "1"}</i> Jev sorts</span>
          <RampIcon name="arrow" size={15} />
          <span className={phase === "pricing" || phase === "sorted" ? "current" : phase === "ready" ? "complete" : ""}><i>{phase === "ready" ? <RampIcon name="check" size={12} /> : "2"}</i> {pricerName} prices</span>
        </div>
        <span className="funding-mode"><span className="live-dot" />Live · your calendar</span>
      </div>
      <div className="funding-stage-body">
        <div className={`agent-scene${working || !state.synced ? " is-working" : ""}${phase === "pricing" ? " is-luna" : ""}`} aria-hidden="true">
          <div className="event-stack"><span /><span /><span><RampIcon name="calendar" size={19} /></span></div>
          {(working || !state.synced) && <div className="eaten-ticket"><RampIcon name={phase === "pricing" ? "coin" : "calendar"} size={15} /></div>}
          <div className={`little-agent ${phase === "pricing" || phase === "ready" ? "agent-luna" : "agent-jev"}`}><span className="agent-eyes"><i /><i /></span><span className="agent-mouth" /><span className="agent-cheek cheek-left" /><span className="agent-cheek cheek-right" /></div>
          <div className="agent-output"><span /><span /><span /></div>
        </div>
        <div className="funding-stage-copy"><h2>{headline}</h2><p role="status" aria-live="polite">{caption}</p></div>
        <button className="primary-button funding-run" disabled={busy || working || !state.synced || !events.length || (phase === "sorted" && !candidates.length) || (phase === "ready" && !ready && !review)}
          onClick={() => phase === "sorted" ? void runPricing() : phase === "ready" ? void approveAll() : void runJev()}>
          {working ? <><span className="funding-spinner" />{phase === "jev" ? "Sorting…" : "Pricing…"}</>
            : phase === "sorted" ? <><RampIcon name="coin" />Price <span>{candidates.length}</span></>
            : phase === "ready" ? <><RampIcon name="check" />Approve all</>
            : <>Run Jev <RampIcon name="arrow" /></>}
        </button>
      </div>
      <div className="funding-wallet">
        <span>Proposed <strong>{formatMoney(phase === "ready" ? proposed : 0)}</strong></span>
        <span>Approved <strong>{formatMoney(approved)}</strong></span>
        {state.summary && <span>Saved vs. per diems <strong>{formatMoney(phase === "ready" ? state.summary.saved : 0)}</strong></span>}
        {phase === "ready" && <button className="undo" disabled={busy} onClick={() => void runJev()}>Run again</button>}
      </div>
    </section>
    <nav className="funding-bins" aria-label="Funding categories">{gates.map((gate) => {
      const matching = events.filter((item) => shown.has(item.event.id) && pipelineGate(item) === gate.id);
      const total = matching.reduce((sum, item) => sum + (item.budget?.amount ?? 0), 0);
      return <button key={gate.id} className={`funding-bin bin-${gate.id}${filter === gate.id ? " selected" : ""}`} disabled={!sorted} aria-pressed={filter === gate.id} onClick={() => setFilter(filter === gate.id ? "all" : gate.id)}>
        <div><RampIcon name={gate.icon} size={17} /><span>{gate.label}</span><RampIcon name="arrow" size={15} /></div>
        <strong>{shown.size ? matching.length : "—"}</strong>
        <span className="bin-caption">{phase === "ready" && gate.id !== "no_budget" ? `${formatMoney(total)} ${gate.id === "needs_review" ? "proposed · check before approving" : "proposed"}` : gate.id === "no_budget" ? "Skips pricing" : gate.id === "needs_budget" ? "Gets a budget" : "Low confidence or capped by policy"}</span>
      </button>;
    })}</nav>
    <div className="funding-table-toolbar">
      <div>
        <button className={`funding-view${filter === "all" ? " active" : ""}`} onClick={() => setFilter("all")}>All events <span>{events.length}</span></button>
        <button className={`funding-view${filter === "funding" ? " active" : ""}`} disabled={!sorted} onClick={() => setFilter("funding")}>Funding candidates <span>{sorted ? candidates.length : "—"}</span></button>
      </div>
      <label className="search-box"><RampIcon name="search" size={14} /><input aria-label="Search pipeline events" placeholder="Search events" value={query} onChange={(e) => setQuery(e.target.value)} /></label>
    </div>
    <div className="funding-table-scroll"><table className="funding-table">
      <thead><tr><th>Event</th><th>When</th><th>Jev’s decision</th><th>Budget</th><th>Status</th><th><span className="sr-only">Details</span></th></tr></thead>
      <tbody>{rows.map((item) => {
        const gate = pipelineGate(item);
        const classified = shown.has(item.event.id);
        const quoteVisible = priced.has(item.event.id);
        const status = rowStatus(item, gate);
        return <tr key={item.event.id} className={classified ? `sorted-row gate-${gate}` : ""}>
          <td><button className="funding-event-name" onClick={() => onOpen(item.event.id)}><span className={`funding-event-icon${gate === "no_budget" && classified ? " muted-icon" : ""}`}><RampIcon name={item.budget?.category === "transport" ? "briefcase" : "calendar"} size={15} /></span><span>{item.event.title}<small>{item.event.location || "Location unknown"}</small></span></button></td>
          <td className="funding-time">{when(item.event.start)}<small>{minutes(item)} min</small></td>
          <td>{classified ? <span className={`funding-gate gate-${gate}`}>{gates.find((g) => g.id === gate)?.label}</span> : <span className="funding-pending">Waiting for Jev</span>}</td>
          <td className="funding-amount">{classified && gate === "no_budget" ? "—" : quoteVisible ? formatMoney(item.budget?.amount ?? 0) : phase === "pricing" && classified ? <span className="amount-loading" /> : "—"}</td>
          <td><span className={`funding-status status-${quoteVisible || gate === "no_budget" ? status.tone : "pending"}`}>{!classified ? "Unsorted" : gate === "no_budget" ? status.label : !quoteVisible ? "Waiting for pricing" : status.label}</span></td>
          <td><button className="icon-button" aria-label={`Details for ${item.event.title}`} onClick={() => onOpen(item.event.id)}><RampIcon name="arrow" size={15} /></button></td>
        </tr>;
      })}{!rows.length && <tr><td colSpan={6} className="empty-state">{state.synced ? "No events in this view." : "Loading calendar…"}</td></tr>}</tbody>
    </table></div>
    <footer className="funding-footer"><span>{rows.length} of {events.length} events · Google Calendar · Card limits are simulated</span></footer>
  </div>;
}
