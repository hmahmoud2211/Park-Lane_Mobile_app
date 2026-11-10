/**
 * Dates and times on the compound's clock (e.g. Africa/Cairo), whatever zone the phone is set to, using the
 * runtime's ICU data. The backend checks bookings in the compound's zone, so the app builds them the same way.
 */

function parts(utcMs: number, timeZone: string) {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(utcMs))
      .map((part) => [part.type, part.value]),
  );
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` };
}

/** The compound's calendar day at that instant, YYYY-MM-DD. */
export const zonedDate = (utcMs: number, timeZone: string) => parts(utcMs, timeZone).date;

/** The compound's wall-clock time at that instant, HH:MM. */
export const zonedTime = (utcMs: number, timeZone: string) => parts(utcMs, timeZone).time;

/** The instant at a wall-clock date and time on the compound's clock. */
export function zonedInstant(date: string, time: string, timeZone: string): number {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  // The zone's offset at that moment, measured, then applied; a second pass settles daylight-saving edges.
  let instant = guess;
  for (let pass = 0; pass < 2; pass += 1) {
    const seen = parts(instant, timeZone);
    const [sy, sm, sd] = seen.date.split('-').map(Number);
    const [sh, smin] = seen.time.split(':').map(Number);
    instant += guess - Date.UTC(sy, sm - 1, sd, sh, smin);
  }
  return instant;
}

/** YYYY-MM-DD plus `count` days. */
export function addDays(date: string, count: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + count));
  return next.toISOString().slice(0, 10);
}
