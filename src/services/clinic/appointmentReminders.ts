import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Platform } from 'react-native';

import type { HealthLang } from '../health/health.types';
import type { Appointment } from './clinic.types';
import { dueReminderIds, REMINDER_MINUTES, reminderFor, remindersFor, type ReminderStatus, type TestResult } from './appointmentReminders.shared';

/**
 * Appointment reminders, scheduled on this phone, so they arrive with the
 * app closed and without a push service. The list of appointments decides:
 * every sync replaces all of them, so a cancelled or moved visit loses its
 * reminder. A change made elsewhere (the clinic, another phone) reaches
 * this phone the next time the clinic screen opens.
 *
 * Reminders never get in the way of booking: a failure is kept, and shown on
 * the appointment's screen (reminderStatus), rather than thrown.
 * On web there are none (appointmentReminders.web.ts).
 */

const ID_PREFIX = 'clinic-appointment:';
const CHANNEL = 'appointments';
const TEST_DELAY_SECONDS = 5;

let lastFailure: string | null = null;
/** Syncs run one at a time: booking and the clinic screen both start one, and each replaces the other's reminders. */
let queue: Promise<void> = Promise.resolve();

// Without this a reminder that fires while the app is open shows nothing.
Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
});

async function allowed(): Promise<boolean> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted || !current.canAskAgain) return current.granted;
  return (await Notifications.requestPermissionsAsync()).granted;
}

async function cancelReminders(keep: Set<string> = new Set()): Promise<void> {
  const scheduled = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(
    scheduled
      .filter((entry) => entry.identifier.startsWith(ID_PREFIX) && !keep.has(entry.identifier.slice(ID_PREFIX.length)))
      .map((entry) => Notifications.cancelScheduledNotificationAsync(entry.identifier)),
  );
}

/** Without exact alarm access Android chooses when to deliver, which can be minutes late. */
async function exactAlarms(): Promise<boolean> {
  try {
    return (await Notifications.getExactAlarmPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/** Matches the phone's reminders to these appointments, asking for permission the first time there is one to set. */
export function syncReminders(appointments: Appointment[], lang: HealthLang): Promise<void> {
  queue = queue.then(() => sync(appointments, lang));
  return queue;
}

/**
 * The trigger's channel. Expo Go on Android can reject creating one, and
 * without a channel the library uses its fallback, so a reminder still arrives.
 */
async function channel(): Promise<{ channelId?: string }> {
  if (Platform.OS !== 'android') return {};
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL, { name: 'Appointments', importance: AndroidImportance.HIGH });
    return { channelId: CHANNEL };
  } catch (error) {
    console.warn('Using the default notification channel', (error as Error).message);
    return {};
  }
}

async function sync(appointments: Appointment[], lang: HealthLang): Promise<void> {
  try {
    const now = Date.now();
    const reminders = remindersFor(appointments, lang, now);
    const due = dueReminderIds(appointments, now);
    if (reminders.length === 0) {
      await cancelReminders(due);
      return;
    }
    if (!(await allowed())) return;
    const reminderChannel = await channel();
    await cancelReminders(due);
    await Promise.all(
      reminders.map((reminder) =>
        Notifications.scheduleNotificationAsync({
          identifier: `${ID_PREFIX}${reminder.appointmentId}`,
          content: { title: reminder.title, body: reminder.body, data: { appointmentId: reminder.appointmentId } },
          trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: reminder.at, ...reminderChannel },
        }),
      ),
    );
    lastFailure = null;
  } catch (error) {
    lastFailure = (error as Error).message;
    console.warn('Could not update appointment reminders', lastFailure);
  }
}

/** What this phone has actually got for an appointment, asked of the phone itself. */
export async function reminderStatus(appointment: Appointment): Promise<ReminderStatus> {
  if (appointment.status !== 'scheduled') return { state: 'not_applicable' };
  const at = new Date(Date.parse(appointment.starts_at) - REMINDER_MINUTES * 60_000);
  if (at.getTime() <= Date.now()) return { state: 'too_soon' };
  try {
    await queue;
    if (!(await Notifications.getPermissionsAsync()).granted) return { state: 'denied' };
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    if (scheduled.some((entry) => entry.identifier === `${ID_PREFIX}${appointment.id}`)) return { state: 'set', at, approximate: !(await exactAlarms()) };
    return { state: 'failed', detail: lastFailure ?? 'The phone has no reminder for this appointment.' };
  } catch (error) {
    return { state: 'failed', detail: (error as Error).message };
  }
}

/**
 * This appointment's reminder in a few seconds, sent the way the real one is.
 * It gets its own identifier, so a sync leaves it and the real reminder alone.
 */
export async function sendTestNotification(appointment: Appointment, lang: HealthLang): Promise<TestResult> {
  try {
    if (!(await allowed())) return { state: 'denied' };
    const testChannel = await channel();
    const reminder = reminderFor(appointment, lang);
    await Notifications.scheduleNotificationAsync({
      content: { title: reminder.title, body: reminder.body, data: { appointmentId: reminder.appointmentId } },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(Date.now() + TEST_DELAY_SECONDS * 1000), ...testChannel },
    });
    return { state: 'sent' };
  } catch (error) {
    return { state: 'failed', detail: (error as Error).message };
  }
}

/** On signing out: the next person on this phone must not get them. */
export async function clearReminders(): Promise<void> {
  await cancelReminders().catch(() => undefined);
}

/** Calls `open` with the appointment when a reminder is tapped, including the tap that launched the app. Returns the unsubscribe. */
export function onReminderOpened(open: (appointmentId: string) => void): () => void {
  const handle = (response: Notifications.NotificationResponse | null) => {
    const id = response?.notification.request.content.data?.appointmentId;
    if (typeof id === 'string') open(id);
  };
  const launch = Notifications.getLastNotificationResponse();
  if (launch) {
    handle(launch);
    Notifications.clearLastNotificationResponse();
  }
  const subscription = Notifications.addNotificationResponseReceivedListener(handle);
  return () => subscription.remove();
}
