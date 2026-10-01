"use client";
import { useState } from "react";
import AppDialog from "./AppDialog";
import type { SendAction } from "./RampAllotApp";
import { buildPresets } from "@/lib/presets";
import { formatMoney, formatTime } from "@/lib/time";
import type { AppResponse } from "@/lib/types";
export default function DemoCardPanel({ state, busy, send, onClose, onResult }: {
  state: AppResponse; busy: boolean; send: SendAction; onClose: () => void; onResult: (message: string) => void;
}) {
  const approved = state.events.filter((item) => !item.archived && item.budget && item.approval === "approved");
  const chargePresets = buildPresets(approved);
  const [eventId, setEventId] = useState(approved[0]?.event.id ?? "");
  const [amount, setAmount] = useState("25");
  const [merchant, setMerchant] = useState("Demo merchant");
  const [result, setResult] = useState<string | null>(null);
  async function charge(body: Record<string, unknown>) {
    const response = await send({ action: "charge", ...body, requestId: crypto.randomUUID() });
    if (response) { const charge = response.charges[0]; setResult(`${charge.result === "approved" ? "Approved" : "Declined"}: ${charge.detail}`); onResult(`Demo charge ${charge.result}.`); }
  }
  return <AppDialog drawer title="Card simulator" onClose={onClose}>
    <p className="muted">Try a charge against an approved event. This uses mock card limits and never moves money.</p>
    <div className="preset-list">{chargePresets.map((preset) => <button key={preset.id} className="preset-button" disabled={busy || !approved.length} onClick={() => void charge(preset)}><strong>{preset.label}</strong><span>{preset.hint}</span></button>)}</div>
    {!approved.length ? <p>Approve an event budget before trying a charge.</p> : <form className="detail-section" onSubmit={(e) => { e.preventDefault(); const item = approved.find((entry) => entry.event.id === eventId); if (item) void charge({ eventId, amount: Number(amount), merchant, time: item.event.start }); }}>
      <label className="field-label" htmlFor="charge-event">Event</label><select id="charge-event" value={eventId} onChange={(e) => setEventId(e.target.value)}>{approved.map((item) => <option key={item.event.id} value={item.event.id}>{item.event.title} · {formatTime(item.event.start)}</option>)}</select>
      <label className="field-label" htmlFor="charge-merchant">Merchant</label><input id="charge-merchant" value={merchant} onChange={(e) => setMerchant(e.target.value)} maxLength={80} required />
      <label className="field-label" htmlFor="charge-amount">Amount (USD)</label><input id="charge-amount" type="number" min="0.01" step="0.01" max="10000" value={amount} onChange={(e) => setAmount(e.target.value)} required />
      <button className="primary-button" disabled={busy}>Try charge at event start</button>
    </form>}
    {result && <p role="status" className="charge-result">{result}</p>}
    {state.charges.length > 0 && <section className="detail-section"><h3>Recent attempts</h3>{state.charges.slice(0, 8).map((charge) => <div key={charge.id} className="charge-history"><strong>{charge.merchant} · {formatMoney(charge.amount)}</strong><span className={charge.result === "declined" ? "flagged" : "success-text"}>{charge.result}</span><p>{charge.detail}</p></div>)}</section>}
  </AppDialog>;
}
