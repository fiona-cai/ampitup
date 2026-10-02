"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import RampSidebar from "./RampSidebar";
import RampIcon from "./RampIcon";
import EventDetails from "./EventDetails";
import DemoCardPanel from "./DemoCardPanel";
import AppDialog from "./AppDialog";
import CalendarPipeline from "./CalendarPipeline";
import NotionContextPanel from "./NotionContextPanel";
import { policy } from "@/lib/policy";
import { dayKey, formatDayKey, formatMoney, formatTime, formatRange } from "@/lib/time";
import { avatarFor, eventCounts, eventStatus, eventWindow, filterEvents, latestChargeFor } from "@/lib/ui-events";
import type { BudgetTab } from "@/lib/ui-events";
import type { AppResponse, PricedEvent, SignedOutResponse } from "@/lib/types";

export type AppAction = Record<string, unknown> & { action: string };
export type SendAction = (body: AppAction) => Promise<AppResponse | null>;
type Page = "context" | "policy" | "sources";
const TABS: { id: BudgetTab; label: string }[] = [
  { id: "overview", label: "Overview" }, { id: "review", label: "Needs review" },
  { id: "live", label: "Live" }, { id: "none", label: "No budget" },
];

export default function AllotApp() {
  const [state, setState] = useState<AppResponse | null>(null);
  const [signedOut, setSignedOut] = useState<SignedOutResponse | null>(null);
  const [workspaceView, setWorkspaceView] = useState<"funding" | "cards">("funding");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<BudgetTab>("overview");
  const [page, setPage] = useState<Page>("context");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [lowConfidence, setLowConfidence] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detailId, setDetailId] = useState<string | null>(null);
  const [menu, setMenu] = useState<"filter" | "options" | "selection" | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [undo, setUndo] = useState<AppAction | null>(null);
  const [cardsOpen, setCardsOpen] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const mutation = useRef(false);

  const receive = useCallback((response: Response, data: AppResponse | SignedOutResponse) => {
    if (response.status === 401 && "signedIn" in data) {
      setSignedOut(data); setState(null); return null;
    }
    if (!response.ok) throw new Error((data as { error?: string }).error || "Could not load events.");
    setSignedOut(null); setState(data as AppResponse);
    return data as AppResponse;
  }, []);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/events", { cache: "no-store" });
      receive(response, await response.json());
      setError(null);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not load events."); }
  }, [receive]);

  const send: SendAction = useCallback(async (body) => {
    if (mutation.current) return null;
    mutation.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/events", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      return receive(response, await response.json());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save this change.");
      return null;
    } finally { mutation.current = false; setBusy(false); }
  }, [receive]);

  useEffect(() => {
    const controller = new AbortController();
    const googleError = new URLSearchParams(window.location.search).get("google_error");
    if (googleError) window.history.replaceState(null, "", window.location.pathname);
    fetch("/api/events", { cache: "no-store", signal: controller.signal })
      .then(async (response) => receive(response, await response.json()))
      .then(() => { if (googleError) setError(googleErrorMessage(googleError)); })
      .catch((caught) => { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Could not load events."); });
    return () => controller.abort();
  }, [receive]);
  const autoSynced = useRef(false);
  useEffect(() => {
    if (!state || state.synced || autoSynced.current) return;
    autoSynced.current = true;
    void send({ action: "sync" });
  }, [state, send]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault(); setPage("context"); setWorkspaceView("cards"); searchRef.current?.focus();
      }
      if (event.key === "Escape") setMenu(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const events = state?.events ?? [];
  const counts = eventCounts(events);
  const visible = filterEvents(events, tab, { query, category, lowConfidenceOnly: lowConfidence });
  const detail = events.find((item) => item.event.id === detailId);
  const chosen = events.filter((item) => selected.has(item.event.id));
  const allSelected = visible.length > 0 && visible.every((item) => selected.has(item.event.id));
  const filterCount = Number(category !== "all") + Number(lowConfidence);

  function announce(message: string, previous: AppAction | null = null) { setToast(message); setUndo(previous); }
  function navigate(target: Page) { setPage(target); setMenu(null); }
  async function sync() {
    if (await send({ action: "sync" })) { announce("Calendar events refreshed."); setSelected(new Set()); }
  }
  async function approve(item: PricedEvent, approval = "approved") {
    if (await send({ action: "decide", eventId: item.event.id, approval })) {
      announce(approval === "approved" ? `Budget approved for ${item.event.title}.` : `Budget paused for ${item.event.title}.`,
        { action: "decide", eventId: item.event.id, approval: item.approval });
    }
  }
  async function bulk(approval: "approved" | "rejected") {
    setMenu(null);
    const targets = chosen.filter((item) => item.budget && !item.archived);
    for (const item of targets) {
      if (!await send({ action: "decide", eventId: item.event.id, approval })) return;
    }
    setSelected(new Set());
    announce(`${targets.length} event budget${targets.length === 1 ? "" : "s"} ${approval === "approved" ? "approved" : "paused"}.`);
  }
  function toggle(id: string) { setSelected((old) => { const next = new Set(old); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  function selectAll() {
    setSelected((old) => {
      const next = new Set(old);
      for (const item of visible) { if (allSelected) next.delete(item.event.id); else next.add(item.event.id); }
      return next;
    });
  }
  function exportEvents() {
    const escape = (value: string) => `"${value.replaceAll('"', '""')}"`;
    const rows = ["Event,Budget (USD),Status,Start,End,Reason", ...visible.map((item) =>
      [item.event.title, item.budget?.amount.toString() ?? "", eventStatus(item), item.event.start, item.event.end,
        item.budget?.reason ?? item.jev.reason].map(escape).join(","))];
    const url = URL.createObjectURL(new Blob([rows.join("\n")], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a"); link.href = url; link.download = "allot-events.csv"; link.click();
    URL.revokeObjectURL(url); setMenu(null);
  }

  return (
    <main className="app-shell">
      <a className="skip-link" href="#event-workspace">Skip to events</a>
      <RampSidebar reviewCount={counts.review} selected={page} onNavigate={navigate}
        onSearch={() => { navigate("context"); setWorkspaceView("cards"); searchRef.current?.focus(); }} onSection={setInfo} />
      <section className="workspace" id="event-workspace" aria-busy={busy}>
        <header className="page-header">
          <div className="title-row">
            <h1 className="page-title">{page === "policy" ? "Spending policy" : page === "sources" ? "Calendar sync" : "Your business events"}</h1>
            {page === "context" && state && <span className="title-count">Google Calendar · {formatRange(state.window.start, state.window.end)} · {events.length} event{events.length === 1 ? "" : "s"}</span>}
            {page === "context" && state && <div className="funding-workspace-switch" aria-label="Allot workspace"><button aria-pressed={workspaceView === "funding"} onClick={() => setWorkspaceView("funding")}>Funding pipeline</button><button aria-pressed={workspaceView === "cards"} onClick={() => setWorkspaceView("cards")}>Cards & calendar</button></div>}
          </div>
        </header>
        {toast && <div className="toast" role="status"><span>{toast}</span>
          {undo && <button className="undo" disabled={busy} onClick={async () => { if (await send(undo)) announce("Change undone."); }}>Undo</button>}
          <button className="icon-button" aria-label="Dismiss notification" onClick={() => setToast(null)}><RampIcon name="close" /></button>
        </div>}
        {error && <div className="error-banner" role="alert"><span>{error}</span><button className="undo" onClick={() => void load()}>Retry</button></div>}
        {signedOut ? <SignInView info={signedOut} /> : page === "policy" ? <PolicyView /> : page === "sources" ? <CalendarView state={state} busy={busy} onSync={sync}
          onHomeCity={async (homeCity) => { if (await send({ action: "profile", homeCity }) && await send({ action: "sync" })) announce(`Home city set to ${homeCity}.`); }}
          onSignOut={async () => { await send({ action: "signout" }); setSelected(new Set()); setDetailId(null); setPage("context"); autoSynced.current = false; announce("Signed out of Google."); }} /> : workspaceView === "funding" && state ? <CalendarPipeline state={state} busy={busy} send={send} onOpen={setDetailId} onAnnounce={announce} /> : <>
          <div className="tabs" role="tablist" aria-label="Event budget status">
            {TABS.map(({ id, label }) => <button key={id} role="tab" aria-selected={tab === id} aria-controls="events-panel"
              className={`tab${tab === id ? " active" : ""}`} onClick={() => { setTab(id); setMenu(null); }}>
              {label} <span className="tab-count">{counts[id]}</span>
            </button>)}
          </div>
          <div className="controls">
            <label className="search-box"><RampIcon name="search" size={15} />
              <input ref={searchRef} aria-label="Search events" placeholder="Search events..." value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <div className="control-row">
              <div className="filter-pills"><div className="locked-filter"><RampIcon name="calendar" size={13} /> Calendar <span>Google · {state?.employee.email ?? "Loading"}</span></div>
                <button className="filter-button" aria-expanded={menu === "filter"} onClick={() => setMenu(menu === "filter" ? null : "filter")}><RampIcon name="plus" size={14} /> Filter</button>
              </div>
              <div className="view-actions">
                <button className="icon-button" aria-label="Filters" aria-expanded={menu === "filter"} onClick={() => setMenu(menu === "filter" ? null : "filter")}><RampIcon name="filter" size={15} />{filterCount > 0 && <span className="tiny-count">{filterCount}</span>}</button>
                <button className="icon-button" aria-label="Calendar sync" title="Calendar sync" onClick={() => navigate("sources")}><RampIcon name="calendar" /></button>
                <button className="icon-button" aria-label="Card simulator" title="Card simulator" onClick={() => setCardsOpen(true)}><RampIcon name="card" /></button>
                <button className="icon-button" aria-label="Remove selected budgets" title="Mark selected events as no budget" disabled={busy || !chosen.some((item) => item.budget)} onClick={() => void bulk("rejected")}><RampIcon name="trash" /></button>
                <button className="options-button" aria-expanded={menu === "options"} onClick={() => setMenu(menu === "options" ? null : "options")}>Options <RampIcon name="chevron" size={14} /></button>
              </div>
            </div>
            {menu === "filter" && <div className="popover filter-popover"><label>Category<select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="all">All categories</option><option value="client_meal">Client meals</option><option value="meal">Meals</option><option value="client_coffee">Coffee</option><option value="transport">Transport</option><option value="default_per_diem">Per diem fallback</option>
            </select></label><label className="checkbox-label"><input type="checkbox" checked={lowConfidence} onChange={(e) => setLowConfidence(e.target.checked)} /> Low confidence only</label>
              <button className="undo" onClick={() => { setCategory("all"); setLowConfidence(false); setQuery(""); }}>Clear filters</button>
            </div>}
            {menu === "options" && <div className="popover options-popover">
              <button disabled={busy} onClick={() => { setMenu(null); void sync(); }}><RampIcon name="refresh" /> Refresh events</button>
              <button disabled={busy || !counts.review} onClick={async () => { setMenu(null); if (await send({ action: "decide", all: true })) announce("All event budgets approved."); }}>Approve all budgets</button>
              <button onClick={exportEvents}><RampIcon name="download" /> Export visible events</button>
              <button onClick={() => { setMenu(null); setCardsOpen(true); }}>Simulate a card charge</button>
              <button disabled={busy} onClick={async () => { setMenu(null); if (await send({ action: "reset" }) && await send({ action: "sync" })) { setSelected(new Set()); setDetailId(null); setTab("overview"); announce("Budgets cleared and recalculated from your calendar."); } }}>Clear approvals and re-price</button>
            </div>}
          </div>
          <div className="table-wrap" role="tabpanel" id="events-panel" aria-label={TABS.find((entry) => entry.id === tab)?.label}>
            <table className="event-table"><thead><tr>
              <th className="check-col"><input type="checkbox" aria-label="Select all visible events" checked={allSelected} onChange={selectAll} disabled={!visible.length} /></th>
              <th className="merchant-col">Event</th><th className="budget-col">Budget</th><th className="reason-col">Reason</th><th className="window-col">Card window</th><th className="small-col">Approve</th><th className="actions-col">Actions</th>
            </tr></thead><tbody>
              {visible.map((item) => <EventRow key={item.event.id} item={item} charge={latestChargeFor(item.event.id, state?.charges ?? [])}
                selected={selected.has(item.event.id)} busy={busy} onSelect={() => toggle(item.event.id)} onOpen={() => setDetailId(item.event.id)} onApprove={() => void approve(item)} />)}
              {!visible.length && <tr><td colSpan={7} className="empty-state">
                {!state ? "Loading calendar…" : !state.synced ? <><p>{busy ? "Reading your Google Calendar…" : "No events synced yet."}</p>{!busy && <button className="primary-button" onClick={() => void sync()}>Sync calendar</button>}</> : !events.length ? <><p>{state.sourceNote ?? "No events in the next 7 days."}</p><button className="primary-button" disabled={busy} onClick={() => void sync()}>Sync again</button></> : <><p>No events match this view.</p><button className="undo" onClick={() => { setTab("overview"); setQuery(""); setCategory("all"); setLowConfidence(false); }}>Show all events</button></>}
              </td></tr>}
            </tbody></table>
          </div>
          <footer className="table-footer">
            <div className="selection-control"><button className="select-footer" aria-expanded={menu === "selection"} onClick={() => setMenu(menu === "selection" ? null : "selection")}>{chosen.length ? `${chosen.length} selected` : "Select"} <RampIcon name="chevron" size={13} /></button>
              {menu === "selection" && <div className="popover selection-popover"><button onClick={selectAll}>{allSelected ? "Clear visible selection" : "Select visible events"}</button><button disabled={busy || !chosen.some((i) => i.budget)} onClick={() => void bulk("approved")}>Approve selected</button><button disabled={busy || !chosen.some((i) => i.budget)} onClick={() => void bulk("rejected")}>No budget for selected</button></div>}
            </div>
            <span>{visible.length ? `1 – ${visible.length}` : "0"} of {events.length} events{state?.summary && <> · {formatMoney(state.summary.allotted)} budgeted vs {formatMoney(state.summary.todayCost)} modeled baseline</>}</span>
          </footer>
        </>}
      </section>
      {detail && <EventDetails key={detail.event.id} item={detail} charges={state?.charges ?? []} busy={busy} onClose={() => setDetailId(null)} send={send} onSaved={announce} />}
      {cardsOpen && state && <DemoCardPanel state={state} busy={busy} send={send} onClose={() => setCardsOpen(false)} onResult={announce} />}
      {info && <AppDialog title={info} onClose={() => setInfo(null)}><p>This navigation item belongs to the Ramp-style shell. The Allot prototype implements event budgets, policy review and simulated card charges.</p><button className="primary-button" onClick={() => { setInfo(null); navigate("context"); }}>Back to Allot</button></AppDialog>}
    </main>
  );
}

function googleErrorMessage(code: string): string {
  switch (code) {
    case "access_denied": return "Google sign-in was cancelled. Allot needs read access to your calendar to set budgets.";
    case "state_mismatch": return "Google sign-in expired or returned to a different address. Start sign-in again from this page.";
    case "not_configured": return "Google sign-in is not configured on this server.";
    case "token_exchange_failed": return "Google rejected the sign-in. Check the OAuth client ID, secret and redirect URI, then try again.";
    default: return "Google sign-in could not finish. Open Calendar sync and try again.";
  }
}

function EventRow({ item, charge, selected, busy, onSelect, onOpen, onApprove }: {
  item: PricedEvent; charge?: AppResponse["charges"][number]; selected: boolean; busy: boolean; onSelect: () => void; onOpen: () => void; onApprove: () => void;
}) {
  const status = eventStatus(item);
  const avatar = avatarFor(item);
  return <tr className={`${status === "none" ? "skipped-row" : ""}${selected ? " selected-row" : ""}`}>
    <td className="check-col"><input type="checkbox" aria-label={`Select ${item.event.title}`} checked={selected} onChange={onSelect} /></td>
    <td><div className="merchant-cell"><div className={`merchant-logo ${avatar.className}`} aria-hidden="true">{avatar.className === "amazon" ? <span className="amazon-smile" /> : avatar.className === "delta" ? <span className="delta-mark" /> : avatar.label}</div>
      <div className="merchant-copy"><div><button className="event-name" onClick={onOpen}>{item.event.title}</button></div><small>
        {status === "none" ? <span>No budget · </span> : charge?.result === "declined" ? <span className="flagged">Charge declined · </span> : item.jev.confidence === "low" ? <span className="flagged">Low confidence · </span> : null}
        {formatDayKey(dayKey(item.event.start))} · {formatTime(item.event.start)}{item.event.location && ` · ${item.event.location}`}
      </small></div><div className="row-indicator">{status === "none" ? <RampIcon name="clock" size={17} /> : <><RampIcon name="user" size={17} /><sup>{item.event.attendees.length || 1}</sup></>}</div>
    </div></td>
    <td><div className="department">{status !== "none" && item.budget?.source === "claude" && <RampIcon name="spark" size={15} />}{status === "none" ? "—" : formatMoney(item.budget?.amount ?? 0)}</div></td>
    <td className="reason">{item.archived ? "Removed or cancelled in source" : item.approval === "rejected" ? "Budget paused by reviewer" : item.budget?.reason ?? item.jev.reason}</td>
    <td className="card-window">{eventWindow(item)}</td>
    <td className="small-col">{status !== "none" && <input type="checkbox" aria-label={`Approve ${item.event.title}`} checked={item.approval === "approved"} disabled={busy || item.approval === "approved"} onChange={onApprove} />}</td>
    <td className="actions-col">{status === "none" ? item.approval === "rejected" && !item.archived ? <button className="undo" disabled={busy} onClick={onApprove}>Restore budget</button> : item.archived ? "Archived" : "Skipped by Jev" : charge ? <button className={`action-detail${charge.result === "declined" ? " flagged" : ""}`} onClick={onOpen}>{formatMoney(charge.amount)} {charge.result === "declined" ? "declined" : "matched (simulated)"}</button> : status === "review" ? <>Needs review. <button className="undo" disabled={busy} onClick={onApprove}>Approve</button></> : <><span>Approved · </span><button className="undo" onClick={onOpen}>Details</button></>}</td>
  </tr>;
}

function PolicyView() {
  return <div className="policy-view"><h2>Company spending policy</h2><p>Budgets are priced against these configured USD caps. Each approved event has its own spending window.</p>
    <table className="policy-table"><thead><tr><th>Category</th><th>Limit</th><th>Applies to</th></tr></thead><tbody>
      {Object.entries(policy.meals).map(([name, cap]) => <tr key={name}><td className="capitalize">{name}</td><td>{formatMoney(cap.solo)} solo · {formatMoney(cap.perPerson)}/person</td><td>Ordinary meals</td></tr>)}
      <tr><td>Client entertainment</td><td>{formatMoney(policy.clientEntertainment.perPerson)}/person</td><td>External client meals</td></tr>
      <tr><td>Airport transport</td><td>{formatMoney(policy.transport.airportMax)}</td><td>Airport transfer</td></tr>
      <tr><td>Local transport</td><td>{formatMoney(policy.transport.localMax)}</td><td>Local rides</td></tr>
    </tbody></table><h2>Card windows</h2><p>Meals open {policy.windows.mealMinutesBefore} minutes before and close {policy.windows.mealMinutesAfter} minutes after an event. Transport opens {policy.windows.transportMinutesBefore} minutes before and closes {policy.windows.transportMinutesAfter} minutes after. A budget cannot borrow from another event.</p>
    <p className="muted">Policy editing and the final forfeiture rule will be added by the project team.</p>
  </div>;
}

function SignInView({ info }: { info: SignedOutResponse }) {
  return <div className="policy-view"><h2>Sign in to see your events</h2>
    <p>Allot reads the next 7 days of your Google Calendar, decides which events need spend, and proposes a budget for each one within policy.</p>
    {info.googleConfigured
      ? <div className="form-actions"><a className="primary-button" href="/api/auth/google">Sign in with Google</a></div>
      : <p role="status">Google sign-in is not configured on this server. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.</p>}
    <p className="muted">Allot only asks for read access to your calendar.</p></div>;
}

function CalendarView({ state, busy, onSync, onHomeCity, onSignOut }: { state: AppResponse | null; busy: boolean; onSync: () => Promise<void>; onHomeCity: (city: string) => Promise<void>; onSignOut: () => Promise<void> }) {
  const [city, setCity] = useState(state?.employee.homeCity ?? "");
  return <div className="policy-view"><h2>Google Calendar</h2><p>{state?.employee.name ?? "Loading…"} · {state?.employee.email}</p>
    <p>{state?.synced ? `${state.events.length} event${state.events.length === 1 ? "" : "s"} loaded for ${formatRange(state.window.start, state.window.end)}.` : "Your calendar hasn't been synced yet."}</p>
    <div className="form-actions"><button className="primary-button" disabled={busy} onClick={() => void onSync()}><RampIcon name="refresh" />{busy ? "Refreshing…" : "Refresh events"}</button><a className="undo" href="/api/auth/google">Switch account</a><button className="undo" disabled={busy} onClick={() => void onSignOut()}>Sign out</button></div>
    {state?.sourceNote && <p role="status">{state.sourceNote}</p>}
    <h2>Home city</h2><p>Days spent entirely outside your home city count as travel days and get a per diem.</p>
    <form className="form-actions" onSubmit={(event) => { event.preventDefault(); if (city.trim()) void onHomeCity(city.trim()); }}>
      <input className="city-input" aria-label="Home city" placeholder="e.g. Waterloo" value={city} onChange={(event) => setCity(event.target.value)} />
      <button className="primary-button" type="submit" disabled={busy || !city.trim() || city.trim() === state?.employee.homeCity}>Save</button>
    </form>
    {state?.storage === "ephemeral" && <p role="status">No database is connected, so approvals on this deployment can reset between requests. Connect Upstash Redis in Vercel to keep them.</p>}
    <p className="muted">Allot only reads your calendar. Company domain: {state?.employee.companyDomain}; attendees outside it count as external.</p><NotionContextPanel /></div>;
}
