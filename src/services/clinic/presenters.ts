import type { StatusTone } from '../../components/ui/StatusChip';
import type { HealthLang } from '../health/health.types';
import { num } from '../health/i18n';
import type { AppointmentStatus, Localized } from './clinic.types';

/** Clinic copy shared by Clinical Appointment's screens, in English and Arabic. */

export const pick = (value: Localized | null | undefined, lang: HealthLang) => (value ? value[lang] || value.en : '');

export const STATUS_TONE: Record<AppointmentStatus, StatusTone> = {
  scheduled: 'violet',
  checked_in: 'teal',
  waiting: 'teal',
  in_consultation: 'indigo',
  completed: 'slate',
  cancelled: 'red',
  no_show: 'amber',
  rescheduled: 'slate',
};

export const STATUS_LABEL: Record<HealthLang, Record<AppointmentStatus, string>> = {
  en: {
    scheduled: 'Scheduled',
    checked_in: 'Checked in',
    waiting: 'Waiting',
    in_consultation: 'With the doctor',
    completed: 'Completed',
    cancelled: 'Cancelled',
    no_show: 'Missed',
    rescheduled: 'Rescheduled',
  },
  ar: {
    scheduled: 'محجوز',
    checked_in: 'تم تسجيل الحضور',
    waiting: 'في الانتظار',
    in_consultation: 'مع الطبيب',
    completed: 'تم',
    cancelled: 'ملغي',
    no_show: 'لم يحضر',
    rescheduled: 'أعيدت جدولته',
  },
};

const WEEKDAYS: Record<HealthLang, string[]> = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  ar: ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'],
};

export const weekday = (index: number, lang: HealthLang) => WEEKDAYS[lang][index];

/** "15:30" in clinic time as "3:30 PM", or "٣:٣٠ م". */
export function clock(time: string, lang: HealthLang): string {
  const [hours, minutes] = time.split(':').map(Number);
  const hour = hours % 12 || 12;
  const suffix = lang === 'ar' ? (hours < 12 ? 'ص' : 'م') : hours < 12 ? 'AM' : 'PM';
  return num(`${hour}:${String(minutes).padStart(2, '0')} ${suffix}`, lang);
}

/** A clinic date as the day strip's chip: "Mon 2" / "الإثنين ٢". */
export function dayChip(date: string, lang: HealthLang): { label: string; detail: string } {
  const [year, month, day] = date.split('-').map(Number);
  const value = new Date(Date.UTC(year, month - 1, day));
  const monthName = new Intl.DateTimeFormat(lang === 'ar' ? 'ar-EG' : 'en-GB', { month: 'short', timeZone: 'UTC' }).format(value);
  return { label: `${weekday(value.getUTCDay(), lang)} ${num(day, lang)}`, detail: monthName };
}

export const fee = (value: number | null, lang: HealthLang) =>
  value === null ? null : lang === 'ar' ? `${num(value.toLocaleString('en-US'), lang)} ج.م` : `EGP ${value.toLocaleString('en-US')}`;

/** Weekly hours grouped by day, e.g. "Sun 09:00–13:00, 16:00–22:00". */
export function hoursByDay(schedule: { weekday: number; start: string; end: string }[], lang: HealthLang): string[] {
  const days = new Map<number, string[]>();
  for (const block of schedule) {
    days.set(block.weekday, [...(days.get(block.weekday) ?? []), `${clock(block.start, lang)}–${clock(block.end, lang)}`]);
  }
  return [...days.entries()].sort(([a], [b]) => a - b).map(([day, blocks]) => `${weekday(day, lang)}: ${blocks.join(lang === 'ar' ? '، ' : ', ')}`);
}

export function initialsOf(name: string): string {
  const words = name.replace(/^(dr\.?|د\.)\s+/i, '').split(/\s+/).filter(Boolean);
  return ((words[0]?.[0] ?? '') + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
}
