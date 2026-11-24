// The deposit dates one collection run reads: from the cursor less an overlap to today. Pure dates, so the
// rule is tested on its own.
/** Days read again behind the cursor: works are found by deposit date, and Crossref's filter index is a little behind its deposits. */
export const OVERLAP_DAYS = 3;
/** The most one run reads back after a pause (a week away is about a thousand works). */
export const MAX_LOOKBACK_DAYS = 21;

export function shiftDay(day: string, days: number): string {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** The deposit dates a run reads, inclusive: from the cursor less the overlap (or the overlap itself on a first run) to today. */
export function collectionWindow(cursor: string | null, today: string): { from: string; until: string } {
  const until = today;
  const earliest = shiftDay(today, -MAX_LOOKBACK_DAYS);
  let from = shiftDay(cursor ?? today, -OVERLAP_DAYS);
  if (from < earliest) from = earliest;
  if (from > until) from = until;
  return { from, until };
}
