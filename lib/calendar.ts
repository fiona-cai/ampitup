import { seedEvents } from "./seed";
import type { CalendarEvent } from "./types";

type GoogleAttendee = { email?: string; displayName?: string };
type GoogleEvent = {
  id?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  attendees?: GoogleAttendee[];
};

function inferCity(text: string): string {
  const haystack = text.toLowerCase();
  if (/waterloo|pearson|\byyz\b/.test(haystack)) return "Waterloo";
  if (/chicago/.test(haystack)) return "Chicago";
  if (/new york|nyc|manhattan|brooklyn|midtown|flatiron|gramercy|javits|laguardia|\blga\b/.test(haystack)) {
    return "New York";
  }
  return "New York";
}

function mapEvent(item: GoogleEvent, index: number): CalendarEvent | null {
  const start = item.start?.dateTime ?? (item.start?.date ? `${item.start.date}T09:00:00-04:00` : "");
  const end = item.end?.dateTime ?? (item.end?.date ? `${item.end.date}T17:00:00-04:00` : "");
  if (!item.summary || !start || !end) return null;
  const attendees = (item.attendees ?? [])
    .filter((attendee) => attendee.email)
    .map((attendee) => ({
      name: attendee.displayName || attendee.email || "Guest",
      email: attendee.email || "",
    }));
  return {
    id: item.id || `gcal-${index}`,
    title: item.summary,
    description: item.description ?? "",
    location: item.location ?? "",
    start,
    end,
    city: inferCity(`${item.location ?? ""} ${item.summary}`),
    attendees,
  };
}

export async function loadCalendar(): Promise<CalendarEvent[]> {
  if (process.env.CALENDAR_SOURCE !== "google" || !process.env.GOOGLE_ACCESS_TOKEN) {
    return seedEvents();
  }

  try {
    const now = new Date();
    const later = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const url = new URL("https://www.googleapis.com/calendar/v3/calendars/primary/events");
    url.searchParams.set("timeMin", now.toISOString());
    url.searchParams.set("timeMax", later.toISOString());
    url.searchParams.set("singleEvents", "true");
    url.searchParams.set("orderBy", "startTime");
    url.searchParams.set("maxResults", "50");

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${process.env.GOOGLE_ACCESS_TOKEN}` },
    });
    if (!response.ok) return seedEvents();
    const body = (await response.json()) as { items?: GoogleEvent[] };
    const events = (body.items ?? [])
      .map(mapEvent)
      .filter((event): event is CalendarEvent => event !== null);
    return events.length > 0 ? events : seedEvents();
  } catch {
    return seedEvents();
  }
}
