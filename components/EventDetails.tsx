"use client";
import { useState } from "react";
import AppDialog from "./AppDialog";
import type { SendAction } from "./RampAllotApp";
import { RULE_LABELS } from "@/lib/jev";
import { formatDayKey, dayKey, formatMoney, formatTime } from "@/lib/time";
import { eventWindow } from "@/lib/ui-events";
import type { ChargeAttempt, PricedEvent } from "@/lib/types";
export default function EventDetails({ item, charges, busy, send, onClose, onSaved }: {
  item: PricedEvent; charges: ChargeAttempt[]; busy: boolean; send: SendAction; onClose: () => void; onSaved: (message: string) => void;
}) {
  const [amount, setAmount] = useState(String(item.budget?.amount ?? ""));
  const [formError, setFormError] = useState<string | null>(null);
  const matching = charges.filter((charge) => charge.eventId === item.event.id);
  async function save() {
    const number = Number(amount);
    if (!amount.trim() || !Number.isFinite(number) || number < 0 || Math.abs(number * 100 - Math.round(number * 100)) > 1e-7) { setFormError("Enter a nonnegative amount with at most two decimal places."); return; }
    const response = await send({ action: "decide", eventId: item.event.id, amount: number });
    if (response) { setFormError(null); setAmount(String(response.events.find((entry) => entry.event.id === item.event.id)?.budget?.amount ?? number)); onSaved("Budget updated within policy."); }
  }
  return <AppDialog drawer title={item.event.title} onClose={onClose}>
    <p className="detail-date">{formatDayKey(dayKey(item.event.start))} · {formatTime(item.event.start)}–{formatTime(item.event.end)}</p>
    <p className="muted">{item.event.location || "No location"} · {item.event.city}</p>
    {item.archived && <p role="status" className="flagged">Removed or cancelled in the source calendar. This event is kept for history and cannot be funded.</p>}
    <section className="detail-section"><h3>Context</h3><p>{item.event.description || "No description provided."}</p><div className="attendee-list">{item.event.attendees.map((person) => <span key={person.email}>{person.name}</span>)}</div></section>
    <section className="detail-section"><h3>Budget reasoning</h3><p>{item.budget?.reason ?? item.jev.reason}</p><dl className="detail-facts"><div><dt>Jev rule</dt><dd>{RULE_LABELS[item.jev.rule] ?? item.jev.rule}</dd></div><div><dt>Confidence</dt><dd className="capitalize">{item.jev.confidence}</dd></div>{item.budget && <><div><dt>Pricing</dt><dd>{item.budget.source === "claude" ? "AI recommendation" : "Policy rate"}</dd></div><div><dt>Policy cap</dt><dd>{formatMoney(item.budget.cap)}</dd></div><div><dt>Card window</dt><dd>{eventWindow(item)}</dd></div><div><dt>Spent (simulated)</dt><dd>{formatMoney(item.limit?.spent ?? 0)}</dd></div><div><dt>Remaining</dt><dd>{formatMoney(Math.max(0, item.budget.amount - (item.limit?.spent ?? 0)))}</dd></div></>}</dl></section>
    {item.budget && !item.archived && <form className="detail-section" onSubmit={(e) => { e.preventDefault(); void save(); }}><label className="field-label" htmlFor="budget-edit">Budget amount (USD)</label><input id="budget-edit" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />{formError && <p role="alert" className="flagged">{formError}</p>}<div className="form-actions"><button className="secondary-button" disabled={busy}>Save amount</button><button type="button" className="primary-button" disabled={busy || item.approval === "approved"} onClick={async () => { if (await send({ action: "decide", eventId: item.event.id, approval: "approved" })) onSaved("Event budget approved."); }}>{item.approval === "approved" ? "Approved" : item.approval === "rejected" ? "Restore budget" : "Approve budget"}</button></div><button type="button" className="undo" disabled={busy || item.approval === "rejected"} onClick={async () => { if (await send({ action: "decide", eventId: item.event.id, approval: "rejected" })) onSaved("Event marked as no budget."); }}>No budget for this event</button></form>}
    {matching.length > 0 && <section className="detail-section"><h3>Simulated charges</h3>{matching.map((charge) => <div key={charge.id} className="charge-history"><strong>{charge.merchant} · {formatMoney(charge.amount)}</strong><span className={charge.result === "declined" ? "flagged" : "success-text"}>{charge.result}</span><p>{charge.detail}</p></div>)}</section>}
  </AppDialog>;
}
