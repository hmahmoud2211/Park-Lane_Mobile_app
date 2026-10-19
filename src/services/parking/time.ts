/**
 * Africa/Cairo time handling.
 *
 * Bookings are entered and shown in Cairo time and stored as UTC. The offset
 * is computed here from Egypt's published rule rather than from `Intl`, so
 * conversions are identical on Hermes, browsers and Node:
 *
 *   - Standard time (EET) is UTC+2.
 *   - Since 2023, summer time (EEST, UTC+3) runs from 00:00 on the last
 *     Friday of April until 24:00 on the last Thursday of October.
 *
 * If Egypt changes the rule, update `cairoOffsetMinutes` (or replace it with
 * an IANA-backed library) and every conversion follows.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
export const DAY_MS = 24 * HOUR;
export { MINUTE as MINUTE_MS, HOUR as HOUR_MS };

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Day of month of the last `weekday` (0 = Sunday) in a UTC month. */
function lastWeekdayOfMonth(year: number, month: number, weekday: number): number {
  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  const back = (lastDay.getUTCDay() - weekday + 7) % 7;
  return lastDay.getUTCDate() - back;
}

/** Cairo's offset from UTC at an instant, in minutes. */
export function cairoOffsetMinutes(utcMs: number): number {
  const year = new Date(utcMs).getUTCFullYear();
  if (year < 2023) {
    return 120;
  }
  // 00:00 EET on the last Friday of April is 22:00 UTC the day before.
  const dstStart = Date.UTC(year, 3, lastWeekdayOfMonth(year, 3, 5)) - 2 * HOUR;
  // 24:00 EEST on the last Thursday of October is 21:00 UTC that Thursday.
  const dstEnd = Date.UTC(year, 9, lastWeekdayOfMonth(year, 9, 4) + 1) - 3 * HOUR;
  return utcMs >= dstStart && utcMs < dstEnd ? 180 : 120;
}

export interface CairoParts {
  year: number;
  /** 1-12. */
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

export function cairoParts(utcMs: number): CairoParts {
  const local = new Date(utcMs + cairoOffsetMinutes(utcMs) * MINUTE);
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
    weekday: local.getUTCDay(),
  };
}

const pad = (value: number) => String(value).padStart(2, '0');

/** "2026-10-13": the Cairo calendar date of an instant. */
export function cairoDateKey(utcMs: number): string {
  const p = cairoParts(utcMs);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Minutes since Cairo midnight. */
export function cairoMinuteOfDay(utcMs: number): number {
  const p = cairoParts(utcMs);
  return p.hour * 60 + p.minute;
}

/**
 * The UTC instant for a Cairo wall-clock time. `minuteOfDay` may run past
 * 1440 for a time on the following day. A wall time skipped by the spring
 * change resolves to the instant just after it.
 */
export function cairoToUtc(dateKey: string, minuteOfDay: number): number {
  const [year, month, day] = dateKey.split('-').map(Number);
  const wall = Date.UTC(year, month - 1, day) + minuteOfDay * MINUTE;
  // Guess with standard time, then correct with the offset in force there.
  let utc = wall - 120 * MINUTE;
  utc = wall - cairoOffsetMinutes(utc) * MINUTE;
  return wall - cairoOffsetMinutes(utc) * MINUTE;
}

/** Adds whole days to a Cairo date key. */
export function addDaysToKey(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + days));
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/* ------------------------------------------------------- Formatting */

const toMs = (value: string | number) => (typeof value === 'number' ? value : Date.parse(value));

/** "02:30 PM". */
export function formatTime(value: string | number): string {
  const p = cairoParts(toMs(value));
  const hour12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return `${pad(hour12)}:${pad(p.minute)} ${p.hour < 12 ? 'AM' : 'PM'}`;
}

/** "02:30 PM" for a minute of the day, for pickers. */
export function formatMinuteOfDay(minuteOfDay: number): string {
  const m = ((minuteOfDay % 1440) + 1440) % 1440;
  const hour = Math.floor(m / 60);
  const hour12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${pad(hour12)}:${pad(m % 60)} ${hour < 12 ? 'AM' : 'PM'}`;
}

/** "Tue 13 Oct 2026". */
export function formatDate(value: string | number, withYear = true): string {
  const p = cairoParts(toMs(value));
  const base = `${WEEKDAYS[p.weekday]} ${pad(p.day)} ${MONTHS[p.month - 1]}`;
  return withYear ? `${base} ${p.year}` : base;
}

/** "Tue 13 Oct" for a Cairo date key. */
export function formatDateKey(dateKey: string): string {
  return formatDate(cairoToUtc(dateKey, 12 * 60), false);
}

/** "Tue 13 Oct, 02:30 PM". */
export function formatDateTime(value: string | number): string {
  return `${formatDate(value, false)}, ${formatTime(value)}`;
}

/** "Tue 13 Oct, 02:00 PM – 05:00 PM", naming the end's date when it differs. */
export function formatRange(start: string | number, end: string | number): string {
  const sameDay = cairoDateKey(toMs(start)) === cairoDateKey(toMs(end));
  return sameDay
    ? `${formatDate(start, false)}, ${formatTime(start)} – ${formatTime(end)}`
    : `${formatDateTime(start)} – ${formatDateTime(end)}`;
}

/** "2h 15m", "45m". */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) {
    return `${rest}m`;
  }
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** "Today", "Tomorrow" or the date, relative to `now`. */
export function relativeDayLabel(dateKey: string, nowMs: number): string {
  const today = cairoDateKey(nowMs);
  if (dateKey === today) {
    return 'Today';
  }
  if (dateKey === addDaysToKey(today, 1)) {
    return 'Tomorrow';
  }
  return formatDateKey(dateKey);
}

export const iso = (ms: number) => new Date(ms).toISOString();
export const ms = (value: string) => Date.parse(value);
