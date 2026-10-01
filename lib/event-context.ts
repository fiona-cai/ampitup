import type { BudgetContext, EventLoad, EventSnapshot, NormalizedEvent } from "./budget-protocol";

const MINUTE = 60000;
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function partsFor(iso: string, timeZone: string) {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23", timeZoneName: "longOffset" });
    formatterCache.set(timeZone, formatter);
  }
  const parts = formatter.formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? "";
  return { date: `${get("year")}-${get("month")}-${get("day")}`, hour: Number(get("hour")), minute: get("minute"), second: get("second"), offset: get("timeZoneName").replace("GMT", "") || "+00:00" };
}

export function dateInZone(iso: string, timeZone: string): string {
  return partsFor(iso, timeZone).date;
}

export function instantInZone(value: number, timeZone: string): string {
  const parts = partsFor(new Date(value).toISOString(), timeZone);
  return `${parts.date}T${String(parts.hour).padStart(2, "0")}:${parts.minute}:${parts.second}${parts.offset}`;
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
}

export function mondayFor(date: string): string {
  return addDays(date, -((new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7));
}

export function midnight(date: string, timeZone: string): number {
  const target = Date.parse(`${date}T00:00:00Z`);
  let guess = target;
  for (let i = 0; i < 4; i++) {
    const offset = partsFor(new Date(guess).toISOString(), timeZone).offset;
    const next = Date.parse(`${date}T00:00:00${offset}`);
    if (guess === next) break;
    guess = next;
  }
  return guess;
}

export function activeEvent(event: NormalizedEvent): boolean {
  return event.status !== "cancelled" && event.attendance !== "declined";
}

export function buildContexts(snapshot: EventSnapshot): Map<string, BudgetContext> {
  const zone = snapshot.subject.timeZone;
  const windowStart = Date.parse(snapshot.window.start), windowEnd = Date.parse(snapshot.window.end);
  const index = snapshot.events.map((event) => ({ event, start: Date.parse(event.schedule.start), end: Date.parse(event.schedule.end), date: dateInZone(event.schedule.start, zone) }));
  const loadCache = new Map<string, EventLoad>();
  const load = (first: string, days: number): EventLoad => {
    const key = `${first}:${days}`;
    const cached = loadCache.get(key);
    if (cached) return cached;
    const from = midnight(first, zone), until = midnight(addDays(first, days), zone);
    const selected = index.filter(({ event, start, end }) => activeEvent(event) && Math.max(start, from, windowStart) < Math.min(end, until, windowEnd));
    const intervals = selected.filter(({ event }) => !event.schedule.allDay).map(({ start, end }) => [Math.max(start, from, windowStart), Math.min(end, until, windowEnd)]).sort((a, b) => a[0] - b[0]);
    let total = 0, left = 0, right = 0;
    intervals.forEach(([start, end], i) => {
      if (i === 0) { left = start; right = end; }
      else if (start <= right) right = Math.max(right, end);
      else { total += right - left; left = start; right = end; }
    });
    if (intervals.length) total += right - left;
    const result = { eventCount: selected.length, busyMinutes: total / MINUTE, highDifficultyCount: selected.filter(({ event }) => event.purpose.difficulty === "high").length, allDayCount: selected.filter(({ event }) => event.schedule.allDay).length, complete: windowStart <= from && until <= windowEnd };
    loadCache.set(key, result);
    return result;
  };
  return new Map(index.map(({ event, start, end, date }) => {
    const weekStart = mondayFor(date);
    const prior = index.filter((other) => other.event.id !== event.id && activeEvent(other.event) && !other.event.schedule.allDay && other.date === date && other.start < start).sort((a, b) => b.end - a.end)[0];
    const gap = prior ? (start - prior.end) / MINUTE : null;
    const travel = event.location.travelFromPreviousMinutes;
    const hour = partsFor(event.schedule.start, zone).hour;
    return [event.id, { date, weekStart, durationMinutes: (end - start) / MINUTE, day: load(date, 1), week: load(weekStart, 7), nearMealTime: (hour >= 6 && hour < 10) || (hour >= 11 && hour < 15) || (hour >= 17 && hour < 22), transition: { previousEventId: prior?.event.id ?? null, gapMinutes: gap, travelMinutes: travel, timePressure: gap !== null && travel !== null ? gap < travel : null } }];
  }));
}
