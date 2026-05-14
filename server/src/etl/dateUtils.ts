/**
 * Normalize any Date to UTC midnight of its **UTC calendar day** (no local TZ drift).
 * Throws if the input is not a finite instant.
 */
export function toUtcCalendarDate(d: Date): Date {
  const t = d.getTime();
  if (!Number.isFinite(t)) {
    throw new Error("Invalid Date: expected a finite instant");
  }
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Yesterday relative to "now", as a UTC calendar date at 00:00Z. */
export function utcYesterdayCalendarDate(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
}
