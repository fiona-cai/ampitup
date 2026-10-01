"use client";

import { useCallback, useEffect, useState } from "react";
import { peopleLine } from "@/lib/attendees";
import { RULE_LABELS } from "@/lib/jev";
import { sameCity } from "@/lib/policy";
import { buildPresets } from "@/lib/presets";
import { demoEmployee } from "@/lib/seed";
import { dayKey, formatDayKey, formatMoney, formatTime, formatRange } from "@/lib/time";
import type { AppResponse, ChargeAttempt, PricedEvent, SpendSummary } from "@/lib/types";

type Action = Record<string, unknown> & { action: string };

const SYNC_STEP_MS = 140;

const GOOGLE_ERRORS: Record<string, string> = {
  access_denied: "Google sign-in was cancelled.",
  not_configured: "Google sign-in isn't set up. Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to .env.local.",
  state_mismatch: "Google sign-in expired or was opened in another tab. Try again.",
  missing_code: "Google didn't return a sign-in code. Try again.",
  token_exchange_failed: "Google sign-in failed. Check the client secret and redirect URI, then try again.",
};

export default function AllotApp() {
  const [state, setState] = useState<AppResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState(0);

  const send = useCallback(async (body: Action) => {
    setBusy(body.action);
    setError(null);
    try {
      const response = await fetch("/api/events", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Request failed.");
      setState(data as AppResponse);
      return data as AppResponse;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Request failed.");
      return null;
    } finally {
      setBusy(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams(window.location.search);
    const googleError = params.get("google_error");
    if (googleError) {
      window.history.replaceState(null, "", window.location.pathname);
    }
    fetch("/api/events")
      .then((response) => response.json())
      .then((data: AppResponse) => {
        if (cancelled) return;
        setState(data);
        setRevealed(data.events.length);
        if (googleError) setError(GOOGLE_ERRORS[googleError] ?? `Google sign-in failed (${googleError}).`);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load your calendar.");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!state || revealed >= state.events.length) return;
    const timer = setTimeout(() => setRevealed((count) => count + 1), SYNC_STEP_MS);
    return () => clearTimeout(timer);
  }, [state, revealed]);

  const sync = async () => {
    setRevealed(0);
    await send({ action: "sync" });
  };

  const reset = async () => {
    setRevealed(0);
    await send({ action: "reset" });
  };

  const signOut = async () => {
    setRevealed(0);
    await send({ action: "signout" });
  };

  if (!state) {
    return (
      <main className="mx-auto flex w-full max-w-5xl flex-1 items-center justify-center p-8 text-sm text-zinc-500">
        {error ?? "Loading…"}
      </main>
    );
  }

  const syncing = busy === "sync" || (state.synced && revealed < state.events.length);

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 px-5 pb-24 pt-8 sm:px-8">
      <Header state={state} onReset={reset} onSignOut={signOut} busy={busy !== null} />
      {error && (
        <p role="alert" className="mt-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      )}

      {!state.connected ? (
        <ConnectPanel
          googleConfigured={state.googleConfigured}
          onConnect={() => send({ action: "connect" })}
          busy={busy === "connect"}
        />
      ) : !state.synced ? (
        <SyncPanel state={state} onSync={sync} busy={busy === "sync"} />
      ) : (
        <>
          <EventsView
            state={state}
            revealed={revealed}
            syncing={syncing}
            busy={busy}
            onResync={sync}
            onDecide={(body) => send({ action: "decide", ...body })}
          />
          {!syncing && (
            <>
              <ChargePanel state={state} busy={busy === "charge"} onCharge={(body) => send({ action: "charge", ...body })} />
              {state.summary && <SavingsSummary summary={state.summary} />}
            </>
          )}
        </>
      )}
    </main>
  );
}

function Header({
  state,
  onReset,
  onSignOut,
  busy,
}: {
  state: AppResponse;
  onReset: () => void;
  onSignOut: () => void;
  busy: boolean;
}) {
  return (
    <header className="flex flex-wrap items-center justify-between gap-4">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-zinc-900 text-sm font-semibold text-lime-300">
          A
        </div>
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Allot</h1>
          <p className="text-xs text-zinc-500">Every dollar tied to a purpose</p>
        </div>
      </div>
      <div className="flex items-center gap-3 text-sm">
        {state.connected && (
          <span className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-zinc-600">
            {state.employee.email}
          </span>
        )}
        {(state.connected || state.synced) && (
          <button
            type="button"
            onClick={onReset}
            disabled={busy}
            className="rounded-full px-3 py-1 text-zinc-500 hover:bg-zinc-200/60 hover:text-zinc-900 disabled:opacity-50"
          >
            Reset demo
          </button>
        )}
        {state.googleAccount && (
          <button
            type="button"
            onClick={onSignOut}
            disabled={busy}
            className="rounded-full px-3 py-1 text-zinc-500 hover:bg-zinc-200/60 hover:text-zinc-900 disabled:opacity-50"
          >
            Sign out
          </button>
        )}
      </div>
    </header>
  );
}

function ConnectPanel({
  googleConfigured,
  onConnect,
  busy,
}: {
  googleConfigured: boolean;
  onConnect: () => void;
  busy: boolean;
}) {
  const buttonClass =
    "flex items-center gap-2 rounded-full border border-zinc-300 bg-white px-5 py-2.5 text-sm font-medium shadow-sm hover:bg-zinc-50 disabled:opacity-50";
  return (
    <section className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-zinc-200 bg-white p-6">
      <div>
        <h2 className="text-lg font-semibold">Connect your calendar</h2>
        <p className="mt-1 text-sm text-zinc-600">
          Allot asks for read-only calendar access. Only the fields needed to price an event are sent to the model.
        </p>
        {!googleConfigured && (
          <p className="mt-2 text-xs text-zinc-400">
            Google sign-in isn&apos;t set up, so this uses the sample account.
          </p>
        )}
      </div>
      {googleConfigured ? (
        <a href="/api/auth/google" className={buttonClass}>
          <GoogleMark />
          Sign in with Google
        </a>
      ) : (
        <button type="button" onClick={onConnect} disabled={busy} className={buttonClass}>
          <GoogleMark />
          {busy ? "Connecting…" : "Continue with the sample account"}
        </button>
      )}
    </section>
  );
}

function SyncPanel({ state, onSync, busy }: { state: AppResponse; onSync: () => void; busy: boolean }) {
  return (
    <section className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-zinc-200 bg-white p-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Your calendar</p>
        <h2 className="mt-1 text-lg font-semibold">
          {state.window.label} · {formatRange(state.window.start, state.window.end)}
        </h2>
        <p className="mt-1 text-sm text-zinc-600">
          Sync pulls every event in the next 7 days, at home or on the road. Jev decides which ones need money, then Claude sets each budget.
        </p>
      </div>
      <button
        type="button"
        onClick={onSync}
        disabled={busy}
        className="rounded-full bg-zinc-900 px-5 py-2.5 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-60"
      >
        {busy ? "Syncing…" : "Sync calendar"}
      </button>
    </section>
  );
}

type DecideBody = { eventId?: string; all?: boolean; approval?: string; amount?: number };

function EventsView({
  state,
  revealed,
  syncing,
  busy,
  onResync,
  onDecide,
}: {
  state: AppResponse;
  revealed: number;
  syncing: boolean;
  busy: string | null;
  onResync: () => void;
  onDecide: (body: DecideBody) => void;
}) {
  const groups = new Map<string, PricedEvent[]>();
  for (const event of state.events.slice(0, revealed)) {
    const key = dayKey(event.event.start);
    groups.set(key, [...(groups.get(key) ?? []), event]);
  }
  const days = [...groups.entries()];

  const budgeted = state.events.filter((event) => event.budget);
  const pending = budgeted.filter((event) => event.approval === "pending");
  const approvedTotal = budgeted
    .filter((event) => event.approval === "approved")
    .reduce((sum, event) => sum + (event.budget?.amount ?? 0), 0);
  const plannedTotal = budgeted
    .filter((event) => event.approval !== "rejected")
    .reduce((sum, event) => sum + (event.budget?.amount ?? 0), 0);

  const viewer = state.source === "sample" ? demoEmployee : state.employee;

  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">
            {state.events.length} events
          </p>
          <h2 className="mt-1 text-xl font-semibold tracking-tight">
            {state.window.label} · {formatRange(state.window.start, state.window.end)}
          </h2>
          <p className="mt-1 text-sm text-zinc-600">
            {syncing ? "Reading the calendar…" : <PricerNote pricer={state.pricer} />}
          </p>
        </div>
        {!syncing && (
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onResync}
              disabled={busy !== null}
              className="rounded-full px-4 py-2 text-sm text-zinc-600 hover:bg-zinc-200/60 disabled:opacity-50"
            >
              Re-sync
            </button>
            <button
              type="button"
              onClick={() => onDecide({ all: true })}
              disabled={busy !== null || pending.length === 0}
              className="rounded-full bg-zinc-900 px-5 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:bg-zinc-300"
            >
              {pending.length === 0 ? `Approved · ${formatMoney(approvedTotal)}` : `Approve all · ${formatMoney(plannedTotal)}`}
            </button>
          </div>
        )}
      </div>

      {state.sourceNote && !syncing && (
        <p className="mt-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
          {state.sourceNote}
        </p>
      )}

      <div className="mt-5 space-y-6">
        {days.map(([key, events]) => (
          <div key={key}>
            <h3 className="mb-2 flex items-center gap-2 text-sm font-medium text-zinc-500">
              {formatDayKey(key)}
              <DayPlace events={events} homeCity={state.employee.homeCity} />
            </h3>
            <ul className="space-y-2">
              {events.map((event) => (
                <EventCard
                  key={event.event.id}
                  item={event}
                  selfEmail={viewer.email}
                  companyDomain={viewer.companyDomain}
                  disabled={busy !== null || syncing}
                  onDecide={onDecide}
                />
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function DayPlace({ events, homeCity }: { events: PricedEvent[]; homeCity: string }) {
  const away = events.find((event) => !sameCity(event.event.city, homeCity));
  if (!away) return <span className="text-xs font-normal text-zinc-400">{homeCity}</span>;
  return (
    <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-800">
      Travel · {away.event.city}
    </span>
  );
}

function PricerNote({ pricer }: { pricer: AppResponse["pricer"] }) {
  if (pricer === "claude") return <>Budgets set by Claude and clamped to policy in code.</>;
  if (pricer === "mixed") return <>Budgets set by Claude, with policy rates where the model call failed.</>;
  return <>Budgets from policy rates. Add an Anthropic API key to have Claude set them.</>;
}

function EventCard({
  item,
  selfEmail,
  companyDomain,
  disabled,
  onDecide,
}: {
  item: PricedEvent;
  selfEmail: string;
  companyDomain: string;
  disabled: boolean;
  onDecide: (body: DecideBody) => void;
}) {
  const { event, jev, budget, approval, limit } = item;
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");

  const muted = !budget || approval === "rejected";

  const save = () => {
    const amount = Number(draft);
    if (Number.isFinite(amount) && amount >= 0) onDecide({ eventId: event.id, amount });
    setEditing(false);
  };

  return (
    <li
      className={`rise rounded-xl border bg-white p-4 ${
        muted ? "border-zinc-200/70" : approval === "approved" ? "border-emerald-200" : "border-zinc-200"
      }`}
    >
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs tabular-nums text-zinc-500">{formatTime(event.start)}</span>
            <h4 className={`font-medium ${muted ? "text-zinc-500" : ""}`}>{event.title}</h4>
            <JevBadge needsBudget={jev.needsBudget} />
            {jev.confidence === "low" && (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                Low confidence
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-zinc-500">
            {[event.location, peopleLine(event, selfEmail, companyDomain)].filter(Boolean).join(" · ")}
          </p>
          <p className={`mt-2 text-sm ${muted ? "text-zinc-500" : "text-zinc-700"}`}>
            {budget ? budget.reason : jev.reason}
          </p>
          <p className="mt-1 text-xs text-zinc-400">
            Jev: {RULE_LABELS[jev.rule] ?? jev.rule}
            {budget && (
              <>
                {" · "}
                {budget.source === "claude" ? "Claude" : "Policy rate"} · {budget.policyRule}
                {budget.clamped && ` · clamped from ${formatMoney(budget.rawAmount)}`}
              </>
            )}
          </p>
          {limit && approval === "approved" && (
            <p className="mt-2 text-xs text-emerald-700">
              Card limit open {formatTime(limit.activeFrom)}–{formatTime(limit.activeUntil)}
              {limit.spent > 0 && ` · ${formatMoney(limit.spent)} spent`}
            </p>
          )}
        </div>

        <div className="flex flex-col items-end gap-2">
          {budget ? (
            editing ? (
              <form
                onSubmit={(submit) => {
                  submit.preventDefault();
                  save();
                }}
                className="flex items-center gap-1"
              >
                <span className="text-sm text-zinc-500">$</span>
                <input
                  autoFocus
                  type="number"
                  min={0}
                  max={budget.cap}
                  value={draft}
                  onChange={(change) => setDraft(change.target.value)}
                  aria-label={`Budget for ${event.title}`}
                  className="w-20 rounded-md border border-zinc-300 px-2 py-1 text-right text-sm tabular-nums"
                />
                <button type="submit" className="rounded-md bg-zinc-900 px-2 py-1 text-xs text-white">
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  className="rounded-md px-2 py-1 text-xs text-zinc-500 hover:bg-zinc-100"
                >
                  Cancel
                </button>
              </form>
            ) : (
              <span
                className={`text-2xl font-semibold tabular-nums ${
                  approval === "rejected" ? "text-zinc-300 line-through" : ""
                }`}
              >
                {formatMoney(budget.amount)}
              </span>
            )
          ) : (
            <span className="text-sm text-zinc-400">No budget</span>
          )}

          {budget && !editing && (
            <div className="flex items-center gap-1 text-xs">
              <StatusPill status={approval} />
              {approval !== "approved" && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onDecide({ eventId: event.id, approval: "approved" })}
                  className="rounded-md px-2 py-1 font-medium text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                >
                  Approve
                </button>
              )}
              <button
                type="button"
                disabled={disabled}
                onClick={() => {
                  setDraft(String(budget.amount));
                  setEditing(true);
                }}
                className="rounded-md px-2 py-1 text-zinc-600 hover:bg-zinc-100 disabled:opacity-50"
              >
                Edit
              </button>
              {approval !== "rejected" && (
                <button
                  type="button"
                  disabled={disabled}
                  onClick={() => onDecide({ eventId: event.id, approval: "rejected" })}
                  className="rounded-md px-2 py-1 text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  Reject
                </button>
              )}
            </div>
          )}
          {budget && editing && <span className="text-xs text-zinc-400">Policy cap {formatMoney(budget.cap)}</span>}
        </div>
      </div>
    </li>
  );
}

function JevBadge({ needsBudget }: { needsBudget: boolean }) {
  return needsBudget ? (
    <span className="rounded-full bg-lime-100 px-2 py-0.5 text-xs font-medium text-lime-800">Budget</span>
  ) : (
    <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs font-medium text-zinc-500">No budget</span>
  );
}

function StatusPill({ status }: { status: PricedEvent["approval"] }) {
  if (status === "approved") return <span className="px-1 font-medium text-emerald-700">Approved</span>;
  if (status === "rejected") return <span className="px-1 font-medium text-red-700">Rejected</span>;
  return <span className="px-1 text-zinc-400">Pending</span>;
}

function ChargePanel({
  state,
  busy,
  onCharge,
}: {
  state: AppResponse;
  busy: boolean;
  onCharge: (body: { amount: number; time: string; merchant: string }) => void;
}) {
  const chargeDays = [...new Set(state.events.map((event) => dayKey(event.event.start)))].sort();
  const [amount, setAmount] = useState("40");
  const [day, setDay] = useState(chargeDays[0] ?? "");
  const [clock, setClock] = useState("12:30");
  const [merchant, setMerchant] = useState("Joe's Pizza");

  const approved = state.events.some((event) => event.approval === "approved");
  const presets = buildPresets(state.events);

  return (
    <section className="mt-10 rounded-2xl border border-zinc-200 bg-white p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-zinc-500">Enforcement</p>
          <h2 className="mt-1 text-lg font-semibold">Try a charge</h2>
          <p className="mt-1 max-w-xl text-sm text-zinc-600">
            Each approved budget is a card limit that opens shortly before its event and closes shortly after. A charge
            can only spend the limit that is open at that moment.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              disabled={busy || !approved}
              onClick={() => onCharge({ amount: preset.amount, time: preset.time, merchant: preset.merchant })}
              title={preset.hint}
              className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium hover:bg-zinc-50 disabled:opacity-40"
            >
              {preset.label}
            </button>
          ))}
        </div>
      </div>

      {!approved ? (
        <p className="mt-4 text-sm text-zinc-500">Approve budgets to create card limits.</p>
      ) : (
        <form
          onSubmit={(submit) => {
            submit.preventDefault();
            onCharge({ amount: Number(amount), time: `${day}T${clock}:00-04:00`, merchant });
          }}
          className="mt-5 flex flex-wrap items-end gap-3 text-sm"
        >
          <Field label="Merchant">
            <input
              value={merchant}
              onChange={(change) => setMerchant(change.target.value)}
              className="w-40 rounded-md border border-zinc-300 px-2 py-1.5"
            />
          </Field>
          <Field label="Amount">
            <input
              type="number"
              min={1}
              value={amount}
              onChange={(change) => setAmount(change.target.value)}
              className="w-24 rounded-md border border-zinc-300 px-2 py-1.5 tabular-nums"
            />
          </Field>
          <Field label="Day">
            <select
              value={day}
              onChange={(change) => setDay(change.target.value)}
              className="rounded-md border border-zinc-300 px-2 py-1.5"
            >
              {chargeDays.map((key) => (
                <option key={key} value={key}>
                  {formatDayKey(key)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Time (ET)">
            <input
              type="time"
              value={clock}
              onChange={(change) => setClock(change.target.value)}
              className="rounded-md border border-zinc-300 px-2 py-1.5"
            />
          </Field>
          <button
            type="submit"
            disabled={busy}
            className="rounded-full bg-zinc-900 px-5 py-2 font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
          >
            {busy ? "Charging…" : "Swipe card"}
          </button>
        </form>
      )}

      {state.charges.length > 0 && (
        <ul className="mt-5 space-y-2">
          {state.charges.map((charge) => (
            <ChargeRow key={charge.id} charge={charge} />
          ))}
        </ul>
      )}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs text-zinc-500">{label}</span>
      {children}
    </label>
  );
}

function ChargeRow({ charge }: { charge: ChargeAttempt }) {
  const declined = charge.result === "declined";
  return (
    <li
      className={`rise flex flex-wrap items-start justify-between gap-3 rounded-xl border px-4 py-3 ${
        declined ? "border-red-200 bg-red-50" : "border-emerald-200 bg-emerald-50"
      }`}
    >
      <div className="min-w-0 flex-1">
        <p className={`text-sm font-medium ${declined ? "text-red-800" : "text-emerald-800"}`}>{charge.detail}</p>
        {charge.report && <p className="mt-1 text-xs text-emerald-700">Expense report: {charge.report}</p>}
      </div>
      <div className="text-right text-sm tabular-nums">
        <div className="font-semibold">{formatMoney(charge.amount)}</div>
        <div className="text-xs text-zinc-500">
          {charge.merchant} · {formatDayKey(dayKey(charge.time))} {formatTime(charge.time)}
        </div>
      </div>
    </li>
  );
}

function SavingsSummary({ summary }: { summary: SpendSummary }) {
  const todayNote =
    summary.travelDays > 0
      ? `${formatMoney(summary.perDiems)} travel per diems + ${formatMoney(summary.reimbursed)} reimbursed`
      : `${formatMoney(summary.reimbursed)} reimbursed`;
  return (
    <section className="mt-10 rounded-2xl bg-zinc-900 p-6 text-white">
      <p className="text-xs font-medium uppercase tracking-wider text-zinc-400">This week</p>
      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Stat label="Without Allot" value={formatMoney(summary.todayCost)} note={todayNote} />
        <Stat
          label="Allot"
          value={formatMoney(summary.allotted)}
          note={`${summary.budgetedEvents} budgets · ${summary.noBudgetEvents} events at $0`}
          accent
        />
        <Stat
          label="Saved"
          value={formatMoney(summary.saved)}
          note={`${formatMoney(summary.allotReimbursements)} reimbursements filed`}
          accent
        />
      </div>
      <p className="mt-5 text-sm text-zinc-300">{summary.narrative}</p>

      <div className="mt-5 overflow-x-auto">
        <table className="w-full text-left text-sm tabular-nums">
          <thead className="text-xs text-zinc-400">
            <tr>
              <th className="py-2 font-normal">Day</th>
              <th className="py-2 text-right font-normal">Allot</th>
              <th className="py-2 text-right font-normal">Per diem</th>
              <th className="py-2 text-right font-normal">Reimbursed</th>
              <th className="py-2 text-right font-normal">Unused per diem</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/10">
            {summary.days.map((day) => (
              <tr key={day.date}>
                <td className="py-2">
                  {day.label}
                  <span className="ml-2 text-xs text-zinc-500">{day.travelCity ?? "home"}</span>
                </td>
                <td className="py-2 text-right">{formatMoney(day.budgeted)}</td>
                <td className={`py-2 text-right ${day.perDiem > 0 ? "" : "text-zinc-500"}`}>
                  {day.perDiem > 0 ? formatMoney(day.perDiem) : "—"}
                </td>
                <td className={`py-2 text-right ${day.reimbursed > 0 ? "text-amber-300" : "text-zinc-500"}`}>
                  {formatMoney(day.reimbursed)}
                </td>
                <td className={`py-2 text-right ${day.unused > 0 ? "text-lime-300" : "text-zinc-500"}`}>
                  {formatMoney(day.unused)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Stat({ label, value, note, accent }: { label: string; value: string; note: string; accent?: boolean }) {
  return (
    <div className="rounded-xl bg-white/5 p-4">
      <p className="text-xs text-zinc-400">{label}</p>
      <p className={`mt-1 text-3xl font-semibold tabular-nums ${accent ? "text-lime-300" : ""}`}>{value}</p>
      <p className="mt-1 text-xs text-zinc-400">{note}</p>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17.1z" />
      <path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.2 0-11.5-4.1-13.4-9.9l-7.9 6.1C6.6 42.6 14.6 48 24 48z" />
    </svg>
  );
}
