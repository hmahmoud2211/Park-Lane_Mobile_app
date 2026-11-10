import type { HealthLang } from '../health/health.types';
import { num } from '../health/i18n';
import type { Appointment } from './clinic.types';
import { clock, pick } from './presenters';

/** How long before an appointment the resident is reminded. */
export const REMINDER_MINUTES = 30;

/** What this device will do about an appointment, shown on its screen so a missing reminder is never a silent one. */
export type ReminderStatus =
  | { state: 'set'; at: Date; approximate: boolean }
  | { state: 'too_soon' | 'denied' | 'not_applicable' | 'phone_only' }
  | { state: 'failed'; detail: string };

/** How a test notification went. */
export type TestResult = { state: 'sent' | 'denied' } | { state: 'failed'; detail: string };

/**
 * Visits whose reminder time has just passed. Android may still be holding
 * that reminder back, so a sync must leave it to arrive.
 */
export function dueReminderIds(appointments: Appointment[], nowMs: number): Set<string> {
  return new Set(
    appointments
      .filter((entry) => {
        const start = Date.parse(entry.starts_at);
        return entry.status === 'scheduled' && start > nowMs && start - REMINDER_MINUTES * 60_000 <= nowMs;
      })
      .map((entry) => entry.id),
  );
}

export interface Reminder {
  appointmentId: string;
  at: Date;
  title: string;
  body: string;
}

/**
 * The reminders these appointments call for: one for each visit still
 * booked whose reminder time is ahead. A visit booked closer than that gets
 * none. Only the patient's first name goes on the lock screen.
 */
export function remindersFor(appointments: Appointment[], lang: HealthLang, nowMs: number): Reminder[] {
  return appointments
    .filter((entry) => entry.status === 'scheduled' && Date.parse(entry.starts_at) - REMINDER_MINUTES * 60_000 > nowMs)
    .map((entry) => reminderFor(entry, lang));
}

/** The reminder for one appointment, whatever its time. */
export function reminderFor(entry: Appointment, lang: HealthLang): Reminder {
  const doctor = pick(entry.doctor.name, lang);
  const time = clock(entry.time, lang);
  const patient = entry.patient.name.trim().split(/\s+/)[0];
  return {
    appointmentId: entry.id,
    at: new Date(Date.parse(entry.starts_at) - REMINDER_MINUTES * 60_000),
    title: lang === 'ar' ? `لديك موعد بعد ${num(REMINDER_MINUTES, 'ar')} دقيقة` : `You have an appointment in ${REMINDER_MINUTES} minutes`,
    body: lang === 'ar' ? `${doctor} الساعة ${time}، لـ ${patient}` : `${doctor} at ${time}, for ${patient}`,
  };
}
