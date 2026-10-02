// Copies the fixture week onto the most recent local Google sign-in's calendar.
//
//   npm run seed:google                    # starts tomorrow
//   npm run seed:google -- --start 2026-10-12
//   npm run seed:google -- --clear         # remove seeded events only
//
// Needs write access: sign in once at http://localhost:3000/api/auth/google?write=1

import { googleConfig, hasScope, readScriptTokens, refreshed, WRITE_SCOPE, writeScriptTokens } from "../lib/google";
import { SEED_WEEK_START, seedEvents } from "../lib/seed";
import { dayKey, LOCAL_TZ } from "../lib/time";
import type { Attendee } from "../lib/types";

try {
  process.loadEnvFile(".env.local");
} catch {}

const EVENTS_URL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
const TAG = { allot: "seed" };
const DAY_MS = 24 * 60 * 60 * 1000;

const EXTERNAL_DOMAINS: Record<string, string> = {
  "acme.com": "acme.example",
  "lumenhealth.com": "lumenhealth.example",
  "brightpath.io": "brightpath.example",
  "gmail.com": "candidate.example",
};

function arg(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

function addDays(key: string, days: number): string {
  return new Date(Date.parse(`${key}T12:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

function localClock(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: LOCAL_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(iso));
}

function shifted(iso: string, days: number) {
  return { dateTime: `${addDays(dayKey(iso), days)}T${localClock(iso)}:00`, timeZone: LOCAL_TZ };
}

function attendeeFor(person: Attendee, selfEmail: string) {
  const [local, domain] = person.email.split("@");
  if (domain === "northwind.co") {
    if (local === "maya.chen") return { email: selfEmail, responseStatus: "accepted" };
    const [selfLocal, selfDomain] = selfEmail.split("@");
    return { email: `${selfLocal}+${local.split(".")[0]}@${selfDomain}`, displayName: person.name };
  }
  return { email: `${local}@${EXTERNAL_DOMAINS[domain] ?? `${domain.split(".")[0]}.example`}`, displayName: person.name };
}

async function google(token: string, url: string, init: RequestInit = {}) {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json", ...init.headers },
  });
  if (!response.ok && response.status !== 410) {
    throw new Error(`${init.method ?? "GET"} ${url} failed (${response.status}): ${await response.text()}`);
  }
  return response.status === 204 || response.status === 410 ? null : response.json();
}

async function clearSeeded(token: string): Promise<number> {
  let removed = 0;
  let pageToken: string | undefined;
  do {
    const url = new URL(EVENTS_URL);
    url.searchParams.set("privateExtendedProperty", "allot=seed");
    url.searchParams.set("maxResults", "250");
    url.searchParams.set("showDeleted", "false");
    if (pageToken) url.searchParams.set("pageToken", pageToken);
    const page = (await google(token, url.toString())) as { items?: { id: string }[]; nextPageToken?: string };
    for (const item of page.items ?? []) {
      await google(token, `${EVENTS_URL}/${item.id}?sendUpdates=none`, { method: "DELETE" });
      removed += 1;
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return removed;
}

async function main() {
  const saved = await readScriptTokens();
  if (!saved) {
    throw new Error("Not signed in. Start the app locally and open http://localhost:3000/api/auth/google?write=1");
  }
  const tokens = await refreshed(saved, googleConfig());
  if (!tokens) throw new Error("Google token expired. Sign in again at http://localhost:3000/api/auth/google?write=1");
  if (tokens !== saved) await writeScriptTokens(tokens);
  if (!hasScope(tokens, WRITE_SCOPE)) {
    throw new Error(
      `${tokens.email} only granted read access. Open http://localhost:3000/api/auth/google?write=1 and allow editing events.`,
    );
  }
  const token = tokens.accessToken;

  const removed = await clearSeeded(token);
  console.log(`Removed ${removed} previously seeded event${removed === 1 ? "" : "s"} from ${tokens.email}.`);
  if (process.argv.includes("--clear")) return;

  const start = arg("--start") ?? addDays(dayKey(new Date().toISOString()), 1);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) throw new Error(`--start must be YYYY-MM-DD, got ${start}`);
  const offset = Math.round((Date.parse(`${start}T12:00:00Z`) - Date.parse(`${SEED_WEEK_START}T12:00:00Z`)) / DAY_MS);

  for (const event of seedEvents()) {
    const guests = event.attendees.length > 1 ? event.attendees.map((person) => attendeeFor(person, tokens.email)) : [];
    const body = {
      summary: event.title,
      description: event.description,
      location: event.location,
      start: shifted(event.start, offset),
      end: shifted(event.end, offset),
      attendees: guests,
      guestsCanSeeOtherGuests: true,
      extendedProperties: { private: TAG },
      reminders: { useDefault: false, overrides: [] },
    };
    await google(token, `${EVENTS_URL}?sendUpdates=none`, { method: "POST", body: JSON.stringify(body) });
    console.log(`  ${body.start.dateTime.replace("T", " ").slice(0, 16)}  ${event.title}`);
  }
  console.log(`Added ${seedEvents().length} events starting ${start}. Sync in the app to see them.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
