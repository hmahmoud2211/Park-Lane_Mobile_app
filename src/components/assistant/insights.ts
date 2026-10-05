import type Ionicons from '@expo/vector-icons/Ionicons';

import type { AnswerSummary } from '../../services/assistant/assistant.types';
import type { RootStackParamList } from '../../types/navigation.types';

type IconName = keyof typeof Ionicons.glyphMap;

export interface IntentMeta {
  label: string;
  icon: IconName;
  /** The app screen covering the same topic, offered as a shortcut. */
  route?: Exclude<keyof RootStackParamList, 'Assistant'>;
}

/** `summary.intent` is stable (FRONTEND_INTEGRATION.md §4.3); unknown ones fall back. */
const INTENTS: Record<string, IntentMeta> = {
  building_overview: { label: 'Building', icon: 'business-outline' },
  alarms: { label: 'Alarms', icon: 'notifications-outline' },
  device_status: { label: 'Systems', icon: 'hardware-chip-outline' },
  energy: { label: 'Energy', icon: 'flash-outline' },
  resident_profile: { label: 'Profile', icon: 'person-circle-outline', route: 'Profile' },
  unit_finance: { label: 'Payments', icon: 'wallet-outline', route: 'MyUnit' },
  parking: { label: 'Parking', icon: 'car-outline', route: 'Parking' },
  visitors: { label: 'Visitors', icon: 'people-outline', route: 'VisitorAccess' },
  maintenance: { label: 'Maintenance', icon: 'construct-outline', route: 'Maintenance' },
  community: { label: 'Community', icon: 'megaphone-outline' },
  weather: { label: 'Weather', icon: 'partly-sunny-outline' },
  general_knowledge: { label: 'General', icon: 'sparkles-outline' },
};

export function intentMeta(intent: unknown): IntentMeta | null {
  return typeof intent === 'string' ? (INTENTS[intent] ?? null) : null;
}

export type InsightTone = 'info' | 'warning' | 'error';

export interface Insight {
  id: string;
  tone: InsightTone;
  icon: IconName;
  label: string;
  /** `sign-in` opens the resident picker. */
  action?: 'sign-in';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Sep 20, 4:40 PM", in the reading's own wall-clock time (as the backend wrote it). */
export function formatReadingTime(iso: string | undefined): string | null {
  if (!iso) {
    return null;
  }
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/.exec(iso);
  if (!match) {
    return null;
  }
  const [, , month, day, hour, minute] = match;
  const date = `${MONTHS[Number(month) - 1] ?? month} ${Number(day)}`;
  if (hour === undefined) {
    return date;
  }
  const h = Number(hour);
  return `${date}, ${h % 12 || 12}:${minute} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * Badges for the flags a reply carries. The answer text already says all of
 * this; the badges make it scannable.
 */
export function insightsFor(summary: AnswerSummary | undefined): Insight[] {
  if (!summary) {
    return [];
  }
  const insights: Insight[] = [];

  if (summary.resident_required) {
    insights.push({
      id: 'sign-in',
      tone: 'info',
      icon: 'log-in-outline',
      label: 'Choose a resident to see your details',
      action: 'sign-in',
    });
  }

  const staleDevice = summary.devices?.find((device) => device.possibly_offline);
  if (summary.possibly_offline || staleDevice) {
    const when = formatReadingTime(summary.latest_data_timestamp ?? staleDevice?.latest_data_timestamp);
    insights.push({
      id: 'offline',
      tone: 'warning',
      icon: 'cloud-offline-outline',
      label: when ? `Last updated ${when}` : 'Readings may be out of date',
    });
  }

  if (summary.is_exact === false && summary.data_period) {
    insights.push({
      id: 'inexact',
      tone: 'info',
      icon: 'calendar-outline',
      label: `Showing ${summary.data_period} instead`,
    });
  }

  if (summary.is_future) {
    insights.push({ id: 'future', tone: 'info', icon: 'time-outline', label: "That period hasn't happened yet" });
  }

  if (summary.error) {
    insights.push({ id: 'error', tone: 'error', icon: 'warning-outline', label: 'Building data is unreachable' });
  }

  return insights;
}
