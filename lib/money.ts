/** Dollar values must represent an exact, nonnegative number of cents. */
export function toCents(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) return null;
  const cents = Math.round(value * 100);
  if (!Number.isSafeInteger(cents) || cents / 100 !== value) return null;
  return cents;
}

export function fromCents(cents: number): number {
  if (!Number.isSafeInteger(cents) || cents < 0) throw new TypeError("Invalid cent amount.");
  return cents / 100;
}
