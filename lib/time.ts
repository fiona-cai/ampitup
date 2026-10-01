export const LOCAL_TZ = "America/New_York";

/** Require an explicit offset and reject Date's permissive calendar rollovers. */
export function parseInstant(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d, h, min, sec, , offset] = match;
  const year = Number(y), month = Number(m), day = Number(d);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1]) return null;
  if (Number(h) > 23 || Number(min) > 59 || Number(sec) > 59) return null;
  if (offset !== "Z" && (Number(offset.slice(1, 3)) > 23 || Number(offset.slice(4, 6)) > 59)) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function localHour(iso: string, timeZone = LOCAL_TZ): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date(iso));
  return Number(parts.find((part) => part.type === "hour")?.value ?? "0");
}

export function dayKey(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: LOCAL_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(iso));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export type MealSlot = "breakfast" | "lunch" | "dinner";

export function mealSlot(iso: string, timeZone = LOCAL_TZ): MealSlot | null {
  const hour = localHour(iso, timeZone);
  if (hour >= 6 && hour < 10) return "breakfast";
  if (hour >= 11 && hour < 15) return "lunch";
  if (hour >= 17 && hour < 22) return "dinner";
  return null;
}

export function formatMoney(amount: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatTime(iso: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: LOCAL_TZ,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

export function formatDayKey(key: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: LOCAL_TZ,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${key}T15:00:00Z`));
}

export function formatRange(start: string, end: string): string {
  const startLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: LOCAL_TZ,
    month: "short",
    day: "numeric",
  }).format(new Date(start));
  const endLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: LOCAL_TZ,
    month: "short",
    day: "numeric",
  }).format(new Date(end));
  return `${startLabel}–${endLabel}`;
}

export function addMinutes(iso: string, minutes: number): string {
  return new Date(new Date(iso).getTime() + minutes * 60_000).toISOString();
}
