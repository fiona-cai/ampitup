import assert from "node:assert/strict";
import { test } from "node:test";
import type { EventSnapshot } from "./budget-protocol";
import { loadNotionSnapshot, mapNotionPage, normalizeNotionPages, notionId, NOTION_API_VERSION } from "./notion";
import template from "../protocol/examples/event-snapshot.json";

const seed = template as unknown as EventSnapshot;
const collectionId = "3ecb83b4-27a2-80ce-a431-f5548d41018f";
const dataSourceId = "01234567-89ab-cdef-0123-456789abcdef";
const text = (value: string) => ({ type: "rich_text", rich_text: [{ plain_text: value }] });
const select = (value: string) => ({ type: "select", select: { name: value } });
const number = (value: number) => ({ type: "number", number: value });
function page(overrides: Record<string, unknown> = {}, id = "87654321-4321-1234-9876-123456789abc") {
  return {
    object: "page", id, last_edited_time: "2026-10-01T14:00:00Z", url: `https://www.notion.so/${id.replace(/-/g, "")}`,
    properties: {
      Name: { type: "title", title: [{ text: { content: "Client lunch" } }] },
      Start: text("2026-10-02T12:00:00-04:00"), End: text("2026-10-02T13:00:00-04:00"),
      "Time zone": select("America/Toronto"), Description: text("Explicit synthetic lunch"),
      "Total attendees": number(3), "External attendees": number(2),
      "Expense facts": text('[{"category":"meal","coverage":"not_covered","estimatedAmountMinor":9000,"beneficiaryCount":3,"notes":"Synthetic meal"}]'),
      Scope: select("work"), Attendance: select("accepted"), Status: text("confirmed"),
      Importance: text("high"), Difficulty: text("moderate"), Location: text("Bistro"), City: select("Waterloo"),
      "Location mode": select("in_person"), Country: select("CA"), "Travel minutes": number(15),
      ...overrides,
    },
  };
}
const map = (source: unknown) => mapNotionPage(source, { collectionId, timeZone: "America/Toronto" });

test("maps explicit Notion text/select/number facts to the canonical contract", () => {
  const event = map(page());
  assert.equal(event.title, "Client lunch");
  assert.equal(event.schedule.start, "2026-10-02T12:00:00-04:00");
  assert.equal(event.schedule.allDay, false);
  assert.deepEqual(event.participants, { totalCount: 3, externalCount: 2 });
  assert.equal(event.expenses?.[0].estimatedAmountMinor, 9000);
  assert.equal(event.expenses?.[0].beneficiaryCount, 3);
  assert.equal(event.sources[0].provider, "notion");
  assert.equal(event.sources[0].collectionId, collectionId);
  assert.deepEqual(event.missingFields, []);
});

test("unknown expense facts stay null and confirmed no expenses stay []", () => {
  assert.equal(map(page({ "Expense facts": text("null") })).expenses, null);
  assert.equal(map(page({ "Expense facts": undefined })).expenses, null);
  assert.deepEqual(map(page({ "Expense facts": text("[]") })).expenses, []);
  assert.ok(map(page({ "Expense facts": undefined })).missingFields.includes("/expenses"));
});

test("provided food never erases a separate unpaid transport line", () => {
  const expenses = [
    { category: "meal", coverage: "provided", estimatedAmountMinor: 0, beneficiaryCount: 3 },
    { category: "transport", coverage: "not_covered", estimatedAmountMinor: 3200, beneficiaryCount: 1 },
  ];
  const event = map(page({ "Expense facts": text(JSON.stringify(expenses)) }));
  assert.equal(event.expenses?.length, 2);
  assert.equal(event.expenses?.[1].estimatedAmountMinor, 3200);
  assert.ok(event.missingFields.includes("/expenses/0/notes"));
});

test("preserves explicit canceled, declined and personal facts without funding assumptions", () => {
  const event = map(page({ Scope: text("personal"), Attendance: text("declined"), Status: text("cancelled") }));
  assert.equal(event.purpose.scope, "personal");
  assert.equal(event.attendance, "declined");
  assert.equal(event.status, "cancelled");
  assert.equal(map({ ...page(), in_trash: true }).status, "cancelled");
});

test("does not infer purpose/attendance/counts from descriptive text", () => {
  const event = map(page({ Scope: undefined, Attendance: undefined, "Total attendees": undefined, "External attendees": undefined, Description: text("Work lunch with two clients") }));
  assert.equal(event.purpose.scope, "unknown");
  assert.equal(event.attendance, "unknown");
  assert.deepEqual(event.participants, { totalCount: null, externalCount: null });
  assert.ok(event.missingFields.includes("/participants/totalCount"));
});

test("supports an explicitly supplied attendee-count JSON object", () => {
  const event = map(page({ "Total attendees": undefined, "External attendees": undefined, "Attendees JSON": text('{"totalCount":5,"externalCount":1}') }));
  assert.deepEqual(event.participants, { totalCount: 5, externalCount: 1 });
});

test("rejects malformed counts and expense money rather than rounding or inventing facts", () => {
  assert.throws(() => map(page({ "Total attendees": number(0) })), /Total attendees/);
  assert.throws(() => map(page({ "External attendees": number(4) })), /cannot exceed/);
  assert.throws(() => map(page({ "Expense facts": text('[{"category":"meal","estimatedAmountMinor":12.50}]') })), /minor units/);
  assert.throws(() => map(page({ "Expense facts": text("not JSON") })), /JSON array/);
});

test("rejects date-only, missing end, impossible timestamps and offset/zone mismatches", () => {
  assert.throws(() => map(page({ Start: text("2026-10-02"), End: text("2026-10-03") })), /untimed\/all-day/);
  assert.throws(() => map(page({ End: undefined })), /End needs an explicit timed/);
  assert.throws(() => map(page({ Start: text("2026-02-30T12:00:00-05:00") })), /valid ISO/);
  assert.throws(() => map(page({ End: text("2026-10-02T11:00:00-04:00") })), /after Start/);
  assert.throws(() => map(page({ Start: text("2026-10-02T12:00:00+01:00") })), /disagrees/);
  assert.throws(() => map(page({ "Time zone": text("Not/AZone") })), /IANA/);
});

test("supports native Notion Date ranges and unique named-zone wall times", () => {
  const event = map(page({ Start: { type: "date", date: { start: "2026-10-02T12:00:00", end: "2026-10-02T13:00:00", time_zone: "America/Toronto" } }, End: undefined }));
  assert.equal(event.schedule.start, "2026-10-02T12:00:00-04:00");
  assert.equal(event.schedule.end, "2026-10-02T13:00:00-04:00");
  assert.throws(() => map(page({ Start: { type: "date", date: { start: "2026-11-01T01:30:00", time_zone: "America/Toronto" } } })), /ambiguous/);
  assert.throws(() => map(page({ Start: { type: "date", date: { start: "2026-03-08T02:30:00", time_zone: "America/Toronto" } } })), /nonexistent/);
});

test("normalization deduplicates page identities and reports invalid rows separately", () => {
  const result = normalizeNotionPages([page(), page(), page({ Start: text("2026-10-02") }, "bad-row"), page({ Start: text("2026-09-29T12:00:00-04:00"), End: text("2026-09-29T13:00:00-04:00") }, "outside-row")], collectionId, seed);
  assert.equal(result.snapshot.events.length, 1);
  assert.equal(result.snapshot.isSimulated, true);
  assert.equal(result.warnings.length, 1);
  assert.equal(result.warnings[0].recordId, "bad-row");
  assert.equal(result.outsideWindowCount, 1);
  assert.ok(!("warnings" in result.snapshot));
  assert.equal(result.snapshot.schemaVersion, "1.0");
});

test("database URLs resolve to canonical UUIDs without confusing view query IDs", () => {
  assert.equal(notionId(`https://www.notion.so/Demo-${collectionId.replace(/-/g, "")}?v=another-view`), collectionId);
  assert.throws(() => notionId("not-a-database"), /UUID/);
});

test("reads current data-source queries with pagination, bearer auth and no source writes", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input); calls.push({ url, init });
    if (url.includes("/databases/")) return Response.json({ data_sources: [{ id: dataSourceId }] });
    return calls.length === 2 ? Response.json({ results: [page()], has_more: true, next_cursor: "next-page" })
      : Response.json({ results: [page(), page({ Name: { type: "title", title: [{ plain_text: "Second event" }] } }, "second-page")], has_more: false, next_cursor: null });
  };
  const result = await loadNotionSnapshot({ token: "test-token", databaseId: collectionId, isSimulated: true }, seed, { fetcher });
  assert.equal(result.snapshot.events.length, 2);
  assert.equal(result.dataSourceId, dataSourceId);
  assert.equal(calls[0].init?.method, "GET");
  assert.ok(calls.slice(1).every((call) => call.init?.method === "POST" && call.url.endsWith("/query")));
  const headers = calls[1].init?.headers as Record<string, string>;
  assert.equal(headers["Notion-Version"], NOTION_API_VERSION);
  assert.equal(headers.Authorization, "Bearer test-token");
  assert.equal(JSON.parse(calls[2].init?.body as string).start_cursor, "next-page");
});

test("API permission failures do not fall back to synthetic rows or echo tokens", async () => {
  const fetcher: typeof fetch = async () => Response.json({ message: "secret-token-in-error-body" }, { status: 403 });
  await assert.rejects(loadNotionSnapshot({ token: "secret-token", databaseId: collectionId, isSimulated: true }, seed, { fetcher }), (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /cannot read/);
    assert.ok(!error.message.includes("secret-token"));
    return true;
  });
});

test("rejects incomplete queries and ambiguous multiple data sources", async () => {
  const incomplete: typeof fetch = async () => Response.json({ results: [page()], has_more: false, request_status: { type: "incomplete" } });
  await assert.rejects(loadNotionSnapshot({ token: "test", dataSourceId, isSimulated: true }, seed, { fetcher: incomplete }), /capped/);
  const multiple: typeof fetch = async () => Response.json({ data_sources: [{ id: collectionId }, { id: dataSourceId }] });
  await assert.rejects(loadNotionSnapshot({ token: "test", databaseId: collectionId, isSimulated: true }, seed, { fetcher: multiple }), /explicitly/);
});

test("repeated pagination cursors fail explicitly instead of looping", async () => {
  const fetcher: typeof fetch = async () => Response.json({ results: [], has_more: true, next_cursor: "repeated" });
  await assert.rejects(loadNotionSnapshot({ token: "test", dataSourceId, isSimulated: true }, seed, { fetcher }), /new cursor/);
});
