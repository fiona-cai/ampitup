import { randomUUID } from "node:crypto";
import type { EventSnapshot, NormalizedEvent, ExpenseCategory } from "./budget-protocol";
import { parseInstant } from "./time";

/** Current API: databases contain data sources; queries return their pages. */
export const NOTION_API_VERSION = "2026-03-11";
const API = "https://api.notion.com/v1";

export const NOTION_PROPERTIES = {
  title: "Name", start: "Start", end: "End", timeZone: "Time zone",
  description: "Description", location: "Location", city: "City",
  totalCount: "Total attendees", externalCount: "External attendees",
  attendees: "Attendees JSON", expenses: "Expense facts", scope: "Scope",
  attendance: "Attendance", status: "Status", importance: "Importance",
  difficulty: "Difficulty", locationMode: "Location mode", country: "Country",
  travelMinutes: "Travel minutes",
} as const;

export type NotionPropertyMap = { [K in keyof typeof NOTION_PROPERTIES]: string };
export type NotionConfig = { token: string; databaseId?: string; dataSourceId?: string; isSimulated: boolean };
export type NotionSnapshotSeed = Pick<EventSnapshot, "subject" | "window" | "policy" | "isSimulated">;
export type NotionWarning = { recordId: string; reason: string };
export type NotionSnapshotResult = {
  snapshot: EventSnapshot; dataSourceId: string; fetchedCount: number;
  outsideWindowCount: number; warnings: NotionWarning[];
};
type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function richText(value: unknown): string {
  if (!Array.isArray(value)) return "";
  return value.map((part) => {
    const item = object(part);
    return typeof item.plain_text === "string" ? item.plain_text : object(item.text).content ?? "";
  }).join("");
}

/** Read an explicitly mapped column, never mine prose for spending facts. */
function propertyValue(value: unknown): unknown {
  const prop = object(value);
  switch (prop.type) {
    case "title": return richText(prop.title);
    case "rich_text": return richText(prop.rich_text);
    case "select": return object(prop.select).name ?? null;
    case "status": return object(prop.status).name ?? null;
    case "number": return prop.number ?? null;
    case "url": return prop.url ?? null;
    case "date": return prop.date ?? null;
    case "formula": return propertyValue(prop.formula);
    default: return null;
  }
}

function nullableText(value: unknown, name: string, max = 2000): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || value.length > max) throw new Error(`${name} must be text of at most ${max} characters.`);
  return value.trim() || null;
}

function integer(value: unknown, name: string, min: number, max: number): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "string" && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value;
  if (typeof parsed !== "number" || !Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${name} must be an integer from ${min} to ${max}, or empty.`);
  }
  return parsed;
}

function choice<T extends string>(value: unknown, values: readonly T[], fallback: T, name: string): T {
  const text = nullableText(value, name, 80)?.toLowerCase();
  if (!text) return fallback;
  if (!values.includes(text as T)) throw new Error(`${name} has an unsupported value.`);
  return text as T;
}

function validZone(value: unknown): value is string {
  if (typeof value !== "string" || !value || value.length > 100) return false;
  try { new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0); return true; }
  catch { return false; }
}

function zoneOffset(instant: number, timeZone: string): number {
  const offset = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(instant).find((part) => part.type === "timeZoneName")?.value ?? "";
  if (offset === "GMT" || offset === "UTC") return 0;
  const match = /^GMT([+-])(\d{2}):(\d{2})$/.exec(offset);
  if (!match) throw new Error("The event time zone has an unsupported historical offset.");
  return (Number(match[2]) * 60 + Number(match[3])) * (match[1] === "+" ? 1 : -1);
}

function timestamp(value: unknown, timeZone: string, name: string): string {
  const date = object(value);
  const raw = typeof value === "string" ? value : date.start;
  if (typeof raw !== "string" || /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error(`${name} needs an explicit timed value; untimed/all-day rows are not spending windows.`);
  }
  let text: string = raw;
  // Notion native Date values may omit seconds; normalize without changing the instant.
  text = text.replace(/T(\d{2}:\d{2})(?=Z|[+-]\d{2}:\d{2}$)/, "T$1:00");
  // Notion permits a named time_zone with offset-free wall time. Resolve only a unique instant.
  if (typeof date.time_zone === "string" && !/(Z|[+-]\d{2}:\d{2})$/.test(text)) {
    if (date.time_zone !== timeZone) throw new Error(`${name} Date time_zone disagrees with Time zone.`);
    text = text.replace(/T(\d{2}:\d{2})$/, "T$1:00");
    const wall = parseInstant(`${text}Z`);
    if (wall === null) throw new Error(`${name} is not a valid local date/time.`);
    const offsets = new Set([-48, -24, 0, 24, 48].map((hours) => zoneOffset(wall + hours * 3_600_000, timeZone)));
    const candidates = [...offsets].filter((offset) => zoneOffset(wall - offset * 60_000, timeZone) === offset);
    if (candidates.length !== 1) throw new Error(`${name} is ambiguous or nonexistent during a time-zone transition; supply an explicit offset.`);
    const offset = candidates[0];
    text += `${offset < 0 ? "-" : "+"}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, "0")}:${String(Math.abs(offset) % 60).padStart(2, "0")}`;
  }
  const instant = parseInstant(text);
  if (instant === null) throw new Error(`${name} must be a valid ISO timestamp with an explicit offset.`);
  const match = /(Z|([+-])(\d{2}):(\d{2}))$/.exec(text)!;
  const suppliedOffset = match[1] === "Z" ? 0 : (Number(match[3]) * 60 + Number(match[4])) * (match[2] === "+" ? 1 : -1);
  if (suppliedOffset !== zoneOffset(instant, timeZone)) throw new Error(`${name} timestamp offset disagrees with Time zone.`);
  return text;
}

function expenseFacts(value: unknown): NormalizedEvent["expenses"] {
  if (value === null || value === undefined || value === "") return null;
  let parsed: unknown = value;
  if (typeof value === "string") {
    try { parsed = JSON.parse(value); } catch { throw new Error("Expense facts must be a JSON array, null, or empty."); }
  }
  if (parsed === null) return null;
  if (!Array.isArray(parsed) || parsed.length > 20) throw new Error("Expense facts must be a JSON array of at most 20 items, or null.");
  const categories: ExpenseCategory[] = ["meal", "coffee", "transport", "lodging", "admission", "supplies", "other"];
  return parsed.map((value) => {
    const item = object(value);
    if (!categories.includes(item.category as ExpenseCategory)) throw new Error("Each expense needs a supported category.");
    return {
      category: item.category as ExpenseCategory,
      coverage: choice(item.coverage, ["not_covered", "provided", "prepaid", "unknown"], "unknown", "Expense coverage"),
      estimatedAmountMinor: integer(item.estimatedAmountMinor, "Expense amount in minor units", 0, 100_000_000),
      beneficiaryCount: integer(item.beneficiaryCount, "Expense beneficiaries", 1, 10_000),
      notes: nullableText(item.notes, "Expense notes"),
    };
  });
}

function missingPointers(value: unknown, path = ""): string[] {
  if (value === null || value === "unknown") return [path];
  if (Array.isArray(value)) return value.flatMap((item, i) => missingPointers(item, `${path}/${i}`));
  if (value && typeof value === "object") return Object.entries(value).flatMap(([key, item]) =>
    missingPointers(item, `${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`));
  return [];
}

/** The source's explicit facts remain intact, including cancellation and declined attendance. */
export function mapNotionPage(pageValue: unknown, options: {
  collectionId: string; timeZone: string; properties?: Partial<NotionPropertyMap>;
}): NormalizedEvent {
  const page = object(pageValue);
  const properties = object(page.properties);
  const mapping = { ...NOTION_PROPERTIES, ...options.properties };
  const get = (key: keyof NotionPropertyMap) => propertyValue(properties[mapping[key]]);
  const recordId = nullableText(page.id, "Page ID", 200);
  if (!recordId) throw new Error("Notion returned a row without a page ID.");
  if (!options.collectionId || options.collectionId.length > 200) throw new Error("A valid collection ID is required.");
  const id = `notion:${options.collectionId}:${recordId}`;
  if (id.length > 200) throw new Error("The namespaced Notion ID is too long.");
  const title = nullableText(get("title"), "Name", 240);
  if (!title) throw new Error("Name is required.");
  const startValue = get("start");
  const startDate = object(startValue);
  const timeZone = nullableText(get("timeZone"), "Time zone", 100) ?? startDate.time_zone ?? options.timeZone;
  if (!validZone(timeZone)) throw new Error("Time zone must be a valid IANA zone.");
  const start = timestamp(startValue, timeZone, "Start");
  // A native Start Date range can supply End; a single date has no implied duration.
  const endValue = get("end") ?? (typeof startDate.end === "string" ? { start: startDate.end, time_zone: startDate.time_zone } : null);
  const end = timestamp(endValue, timeZone, "End");
  if (parseInstant(start)! >= parseInstant(end)!) throw new Error("End must be after Start.");
  const updatedAt = nullableText(page.last_edited_time, "Page last-edited time", 100);
  if (parseInstant(updatedAt) === null) throw new Error("The page needs a valid last-edited timestamp.");
  const sourceUrl = nullableText(page.url, "Page URL");
  if (sourceUrl && !/^https:\/\//.test(sourceUrl)) throw new Error("The page URL must use HTTPS.");
  let attendees: JsonObject = {};
  const attendeesText = get("attendees");
  if (attendeesText !== null && attendeesText !== "") {
    try { attendees = object(typeof attendeesText === "string" ? JSON.parse(attendeesText) : attendeesText); }
    catch { throw new Error("Attendees JSON must be an object with totalCount/externalCount."); }
    if (!Object.keys(attendees).length) throw new Error("Attendees JSON must explicitly supply counts.");
  }
  const totalCount = integer(get("totalCount") ?? attendees.totalCount, "Total attendees", 1, 10_000);
  const externalCount = integer(get("externalCount") ?? attendees.externalCount, "External attendees", 0, 10_000);
  if (totalCount !== null && externalCount !== null && externalCount > totalCount) throw new Error("External attendees cannot exceed total attendees.");
  const country = nullableText(get("country"), "Country", 2)?.toUpperCase() ?? null;
  if (country && !/^[A-Z]{2}$/.test(country)) throw new Error("Country must be a two-letter code.");
  const event: NormalizedEvent = {
    id, sources: [{ provider: "notion", collectionId: options.collectionId, recordId, updatedAt: updatedAt!, url: sourceUrl }],
    title, description: nullableText(get("description"), "Description"),
    status: page.archived === true || page.in_trash === true ? "cancelled" : choice(get("status"), ["confirmed", "tentative", "cancelled"], "tentative", "Status"),
    attendance: choice(get("attendance"), ["accepted", "tentative", "declined", "unknown"], "unknown", "Attendance"),
    schedule: { start, end, timeZone, allDay: false },
    purpose: {
      scope: choice(get("scope"), ["work", "personal", "unknown"], "unknown", "Scope"),
      importance: choice(get("importance"), ["low", "normal", "high", "unknown"], "unknown", "Importance"),
      difficulty: choice(get("difficulty"), ["low", "moderate", "high", "unknown"], "unknown", "Difficulty"),
    },
    location: {
      mode: choice(get("locationMode"), ["in_person", "virtual", "hybrid", "unknown"], "unknown", "Location mode"),
      label: nullableText(get("location"), "Location"), city: nullableText(get("city"), "City", 200), countryCode: country,
      travelFromPreviousMinutes: integer(get("travelMinutes"), "Travel minutes", 0, 1440),
    },
    participants: { totalCount, externalCount }, expenses: expenseFacts(get("expenses")), missingFields: [],
  };
  event.missingFields = missingPointers(event);
  return event;
}

export function notionConfig(): NotionConfig | null {
  const token = process.env.NOTION_TOKEN || process.env.NOTION_API_KEY;
  const databaseId = process.env.NOTION_DATABASE_ID;
  const dataSourceId = process.env.NOTION_DATA_SOURCE_ID;
  if (!token || (!databaseId && !dataSourceId)) return null;
  return { token, databaseId, dataSourceId, isSimulated: process.env.NOTION_IS_SIMULATED !== "false" };
}

export function notionId(input: string): string {
  const withoutQuery = input.split(/[?#]/)[0];
  const match = withoutQuery.match(/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}|[a-f0-9]{32})$/i);
  if (!match) throw new Error("Use a Notion database/data-source UUID or its page URL.");
  const id = match[1].replace(/-/g, "").toLowerCase();
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

export class NotionApiError extends Error {
  constructor(message: string, public readonly status: number) { super(message); this.name = "NotionApiError"; }
}

async function requestNotion(path: string, config: NotionConfig, fetcher: typeof fetch, body?: unknown): Promise<JsonObject> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const response = await fetcher(`${API}${path}`, {
      method: body === undefined ? "GET" : "POST",
      headers: { Authorization: `Bearer ${config.token}`, "Notion-Version": NOTION_API_VERSION, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store", signal: AbortSignal.timeout(15_000),
    });
    if (response.status === 429 && attempt < 2) {
      const seconds = Number(response.headers.get("Retry-After") ?? "1");
      await new Promise((resolve) => setTimeout(resolve, Math.min(5, Math.max(0.1, Number.isFinite(seconds) ? seconds : 1)) * 1000));
      continue;
    }
    if (!response.ok) {
      const message = response.status === 401 ? "Notion rejected the server token."
        : response.status === 403 || response.status === 404 ? "The Notion connection cannot read this database. Share it with the read-only connection and check the ID."
          : `Notion API request failed (${response.status}).`;
      // Do not echo error bodies: they can contain workspace data or credentials.
      throw new NotionApiError(message, response.status);
    }
    return object(await response.json());
  }
  throw new NotionApiError("Notion is rate limited; retry the sync shortly.", 429);
}

export function normalizeNotionPages(pages: unknown[], collectionId: string, seed: NotionSnapshotSeed, options: {
  generatedAt?: string; snapshotId?: string; properties?: Partial<NotionPropertyMap>;
} = {}): NotionSnapshotResult {
  const windowStart = parseInstant(seed.window.start), windowEnd = parseInstant(seed.window.end);
  if (windowStart === null || windowEnd === null || windowStart >= windowEnd) throw new Error("The snapshot window needs valid start/end instants.");
  if (!validZone(seed.subject.timeZone)) throw new Error("The snapshot subject needs an IANA time zone.");
  if (pages.length > 10_000) throw new Error("Notion import exceeds the 10,000-row snapshot limit.");
  const events = new Map<string, NormalizedEvent>();
  const warnings: NotionWarning[] = [];
  let outsideWindowCount = 0;
  for (const page of pages) {
    try {
      const event = mapNotionPage(page, { collectionId, timeZone: seed.subject.timeZone, properties: options.properties });
      const start = parseInstant(event.schedule.start)!;
      if (start < windowStart || start >= windowEnd) { outsideWindowCount++; continue; }
      const previous = events.get(event.id);
      if (!previous || parseInstant(previous.sources[0].updatedAt)! < parseInstant(event.sources[0].updatedAt)!) events.set(event.id, event);
    } catch (error) {
      warnings.push({ recordId: typeof object(page).id === "string" ? object(page).id as string : "unknown", reason: error instanceof Error ? error.message : "Invalid Notion row." });
    }
  }
  const generatedAt = options.generatedAt ?? new Date().toISOString();
  if (parseInstant(generatedAt) === null) throw new Error("generatedAt must be a valid instant.");
  return {
    snapshot: {
      schemaVersion: "1.0", snapshotId: options.snapshotId ?? `notion-${randomUUID()}`, generatedAt,
      isSimulated: seed.isSimulated, subject: seed.subject, window: seed.window, policy: seed.policy,
      events: [...events.values()].sort((a, b) => parseInstant(a.schedule.start)! - parseInstant(b.schedule.start)! || a.id.localeCompare(b.id)),
    },
    dataSourceId: collectionId, fetchedCount: pages.length, outsideWindowCount, warnings,
  };
}

/** Read-only access; query POSTs do not create or update Notion records. */
export async function loadNotionSnapshot(config: NotionConfig, seed: NotionSnapshotSeed, options: {
  fetcher?: typeof fetch; properties?: Partial<NotionPropertyMap>;
} = {}): Promise<NotionSnapshotResult> {
  const fetcher = options.fetcher ?? fetch;
  let dataSourceId = config.dataSourceId ? notionId(config.dataSourceId) : null;
  if (!dataSourceId) {
    if (!config.databaseId) throw new Error("NOTION_DATABASE_ID or NOTION_DATA_SOURCE_ID is required.");
    const database = await requestNotion(`/databases/${notionId(config.databaseId)}`, config, fetcher);
    const sources = Array.isArray(database.data_sources) ? database.data_sources.map(object) : [];
    if (sources.length !== 1 || typeof sources[0].id !== "string") throw new Error("Select NOTION_DATA_SOURCE_ID explicitly when the database has zero or multiple data sources.");
    dataSourceId = notionId(sources[0].id);
  }
  const pages: unknown[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const result = await requestNotion(`/data_sources/${dataSourceId}/query`, config, fetcher, { page_size: 100, result_type: "page", ...(cursor ? { start_cursor: cursor } : {}) });
    if (object(result.request_status).type === "incomplete") throw new Error("Notion capped this query; narrow the data source before exporting a complete snapshot.");
    if (!Array.isArray(result.results)) throw new Error("Notion returned an invalid query response.");
    pages.push(...result.results);
    if (pages.length > 10_000) throw new Error("Notion import exceeds the 10,000-row snapshot limit.");
    if (result.has_more !== true) break;
    if (typeof result.next_cursor !== "string" || !result.next_cursor || cursors.has(result.next_cursor)) throw new Error("Notion pagination did not provide a new cursor.");
    cursor = result.next_cursor; cursors.add(cursor);
  } while (true);
  return normalizeNotionPages(pages, dataSourceId, { ...seed, isSimulated: config.isSimulated }, { properties: options.properties });
}
