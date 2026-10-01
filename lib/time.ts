export const LOCAL_TZ = "America/New_York";

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
    maximumFractionDigits: 0,
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
