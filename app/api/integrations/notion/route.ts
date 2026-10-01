import type { EventSnapshot } from "@/lib/budget-protocol";
import { loadNotionSnapshot, notionConfig, NotionApiError } from "@/lib/notion";
import template from "@/protocol/examples/event-snapshot.json";

export const dynamic = "force-dynamic";

/** Isolated read-only export. It never approves a budget or mutates a Notion page. */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const config = notionConfig();
  const headers = { "Cache-Control": "no-store" };
  if (url.searchParams.get("status") === "1") {
    return Response.json({ configured: !!config, ...(!config ? { error: "Set the read-only Notion token and database/data-source ID on the server." } : {}) }, { headers });
  }
  if (!config) return Response.json({ configured: false, error: "Notion is not configured. Browser sign-in does not grant this server API access." }, { status: 503, headers });
  try {
    const seed = template as unknown as EventSnapshot;
    const result = await loadNotionSnapshot(config, {
      subject: seed.subject, policy: seed.policy, isSimulated: config.isSimulated,
      window: { start: url.searchParams.get("start") ?? seed.window.start, end: url.searchParams.get("end") ?? seed.window.end },
    });
    if (url.searchParams.get("diagnostics") === "1") {
      return Response.json({ fetchedCount: result.fetchedCount, eventCount: result.snapshot.events.length, outsideWindowCount: result.outsideWindowCount, skippedRecords: result.warnings }, { headers });
    }
    return Response.json(result.snapshot, {
      headers: {
        ...headers,
        "X-Notion-Skipped-Records": String(result.warnings.length),
        "X-Notion-Outside-Window": String(result.outsideWindowCount),
        ...(url.searchParams.get("download") === "1" ? { "Content-Disposition": 'attachment; filename="notion-snapshot.json"' } : {}),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Notion export failed.";
    const status = error instanceof NotionApiError ? (error.status === 401 || error.status === 403 || error.status === 404 ? 502 : 503) : 400;
    return Response.json({ configured: true, error: message }, { status, headers });
  }
}
