"use client";

import { useEffect, useState } from "react";
import type { EventSnapshot } from "@/lib/budget-protocol";

export default function NotionContextPanel() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch("/api/integrations/notion?status=1", { signal: controller.signal, cache: "no-store" })
      .then((response) => response.json())
      .then((status) => setConfigured(status.configured === true))
      .catch(() => { if (!controller.signal.aborted) setMessage("Notion connection status is unavailable."); });
    return () => controller.abort();
  }, []);

  async function exportContext() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/integrations/notion", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Notion sync failed.");
      if (data.schemaVersion !== "1.0" || !Array.isArray(data.events)) throw new Error("Notion returned an invalid event snapshot.");
      const snapshot = data as EventSnapshot;
      const skipped = Number(response.headers.get("X-Notion-Skipped-Records") ?? 0);
      const url = URL.createObjectURL(new Blob([JSON.stringify(snapshot, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = "notion-snapshot.json";
      link.click();
      URL.revokeObjectURL(url);
      setConfigured(true);
      setMessage(`Exported ${snapshot.events.length} Notion events${snapshot.isSimulated ? " from the synthetic demo database" : ""}.${skipped > 0 ? ` Skipped ${skipped} invalid or untimed rows; see the connector diagnostics.` : ""}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Notion sync failed.");
    } finally {
      setBusy(false);
    }
  }

  return <section style={{ marginTop: 32 }}>
    <h2>Notion context</h2>
    <p>Read event plans and expense facts from Notion and export them in the shared event JSON format.</p>
    <div className="form-actions"><button className="primary-button" disabled={busy} onClick={() => void exportContext()}>{busy ? "Reading Notion…" : "Export Notion events"}</button></div>
    {configured === false && <p className="muted">Notion API access is not configured on this server yet.</p>}
    {message && <p role="status">{message}</p>}
    <p className="muted">Read-only export. This does not approve budgets or issue cards.</p>
  </section>;
}
