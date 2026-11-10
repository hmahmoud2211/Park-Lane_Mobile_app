import type { HealthLang } from '../health/health.types';
import type { ReminderStatus, TestResult } from './appointmentReminders.shared';
import type { Appointment } from './clinic.types';

/** Reminders go to the resident's phone only (appointmentReminders.ts); a browser on a desk shows none. */

export async function syncReminders(_appointments: Appointment[], _lang: HealthLang): Promise<void> {}

export async function clearReminders(): Promise<void> {}

export async function reminderStatus(_appointment: Appointment): Promise<ReminderStatus> {
  return { state: 'phone_only' };
}

export async function sendTestNotification(_appointment: Appointment, _lang: HealthLang): Promise<TestResult> {
  return { state: 'failed', detail: 'Open the app on a phone to test notifications.' };
}

export function onReminderOpened(_open: (appointmentId: string) => void): () => void {
  return () => undefined;
}
