import { parseInstant } from "./time";
import type { CalendarEvent, CalendarSource, SyncWindow } from "./types";

const EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const DAY_MS = 24 * 60 * 60 * 1000;

type GoogleAttendee = {
  email?: string;
  displayName?: string;
  self?: boolean;
  resource?: boolean;
  responseStatus?: string;
};
type GoogleEvent = {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: GoogleAttendee[];
};

export type CalendarLoad = {
  events: CalendarEvent[];
  source: CalendarSource;
  note: string | null;
  window: SyncWindow;
};

function inferCity(text: string, homeCity: string): string {
  const haystack = text.toLowerCase();
  if (/waterloo|pearson|\byyz\b/.test(haystack)) return "Waterloo";
  if (/chicago/.test(haystack)) return "Chicago";
  if (/new york|nyc|manhattan|brooklyn|midtown|flatiron|gramercy|javits|laguardia|\blga\b/.test(haystack)) {
    return "New York";
  }
  return homeCity;
}

function stripHtml(text: string): string {
  return text.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

export function mapEvent(item: GoogleEvent, index: number, homeCity: string): CalendarEvent | null {
  if (item.status === "cancelled") return null;
  // A date-only event supplies no spending window; do not invent working hours.
  if (item.start?.date !== undefined || item.end?.date !== undefined) return null;
  const start = item.start?.dateTime;
  const end = item.end?.dateTime;
  if (!item.summary || !start || !end) return null;
  const startTime = parseInstant(start);
  const endTime = parseInstant(end);
  if (startTime === null || endTime === null || startTime >= endTime) return null;

  const people = (item.attendees ?? []).filter((attendee) => attendee.email && !attendee.resource);
  if (people.some((attendee) => attendee.self && attendee.responseStatus === "declined")) return null;

  return {
    id: item.id || `gcal-${index}`,
    title: item.summary,
    description: stripHtml(item.description ?? ""),
    location: item.location ?? "",
    start,
    end,
    city: inferCity(`${item.location ?? ""} ${item.summary}`, homeCity),
    attendees: people.map((attendee) => ({
      name: attendee.displayName || attendee.email || "Guest",
      email: attendee.email || "",
    })),
  };
}

export class CalendarError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function loadCalendar(token: string, homeCity: string): Promise<CalendarLoad> {
  const now = new Date();
  const later = new Date(now.getTime() + 7 * DAY_MS);
  const url = new URL(EVENTS_URL);
  url.searchParams.set("timeMin", now.toISOString());
  url.searchParams.set("timeMax", later.toISOString());
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("maxResults", "50");

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
  } catch {
    throw new CalendarError(502, "Couldn't reach Google Calendar. Try again in a moment.");
  }
  if (response.status === 401 || response.status === 403) {
    throw new CalendarError(401, "Google rejected the calendar request. Sign out and sign in again.");
  }
  if (!response.ok) throw new CalendarError(502, `Google Calendar returned ${response.status}. Try again in a moment.`);

  const body = (await response.json()) as { items?: GoogleEvent[] };
  const events = (body.items ?? [])
    .map((item, index) => mapEvent(item, index, homeCity))
    .filter((event): event is CalendarEvent => event !== null);
  return {
    events,
    source: "google",
    note: events.length ? null : "Your calendar has no events in the next 7 days.",
    window: { label: "Next 7 days", start: now.toISOString(), end: later.toISOString() },
  };
}
