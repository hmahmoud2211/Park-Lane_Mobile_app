import { config } from '../config.ts';

/**
 * Clinic time. Schedules are written in the clinic's own zone
 * (CLINIC_TIMEZONE, Africa/Cairo by default) and appointments are stored as
 * UTC instants, so daylight saving and travelling devices never move a
 * booking. Uses the runtime's ICU data; nothing is hard-coded per zone.
 */

const tz = () => config.clinic.timezone;

const formatters = new Map<string, Intl.DateTimeFormat>();

function parts(utcMs: number, zone: string) {
  let formatter = formatters.get(zone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatters.set(zone, formatter);
  }
  const values = Object.fromEntries(formatter.formatToParts(new Date(utcMs)).map((part) => [part.type, part.value]));
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
  };
}

/** The zone's offset from UTC at that instant, in ms. */
function offsetMs(utcMs: number, zone: string): number {
  const p = parts(utcMs, zone);
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - (utcMs - (utcMs % 1000));
}

/** `2026-11-02` + `15:30` in clinic time, as a UTC instant (ms). */
export function clinicInstant(date: string, time: string, zone = tz()): number {
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const first = wall - offsetMs(wall, zone);
  // Near a DST change the offset at the guess can differ from the offset at the answer.
  const second = wall - offsetMs(first, zone);
  return second;
}

const pad = (value: number) => String(value).padStart(2, '0');

/** The clinic's calendar date at an instant: `YYYY-MM-DD`. */
export function clinicDate(utcMs: number, zone = tz()): string {
  const p = parts(utcMs, zone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** The clinic's wall-clock time at an instant: `HH:MM`. */
export function clinicTime(utcMs: number, zone = tz()): string {
  const p = parts(utcMs, zone);
  return `${pad(p.hour)}:${pad(p.minute)}`;
}

/** 0 Sunday .. 6 Saturday, for a calendar date. */
export function weekdayOf(date: string): number {
  const [year, month, day] = date.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

export function addDays(date: string, count: number): string {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + count));
  return `${next.getUTCFullYear()}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

/** The UTC instants that bound a clinic calendar day. */
export function clinicDayBounds(date: string): { from: string; to: string } {
  return {
    from: new Date(clinicInstant(date, '00:00')).toISOString(),
    to: new Date(clinicInstant(addDays(date, 1), '00:00')).toISOString(),
  };
}

export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
export const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;

export const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
export const timeOf = (minutes: number) => `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;

/** Whole years between a date of birth and an instant; null without one. */
export function ageAt(dateOfBirth: string | null, atMs: number): number | null {
  if (!dateOfBirth) return null;
  const birth = new Date(`${dateOfBirth}T00:00:00Z`);
  const at = new Date(atMs);
  let age = at.getUTCFullYear() - birth.getUTCFullYear();
  if (at.getUTCMonth() < birth.getUTCMonth() || (at.getUTCMonth() === birth.getUTCMonth() && at.getUTCDate() < birth.getUTCDate())) {
    age -= 1;
  }
  return age;
}
