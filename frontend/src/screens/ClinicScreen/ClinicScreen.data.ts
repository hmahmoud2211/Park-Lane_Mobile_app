import type { HealthLang } from '../../types/health.types';
import { num } from '../../features/health/services/i18n';

/** Clinical Appointment's home. No Figma frame exists yet; built from Health Passport's panels. */
export const clinicCopy = {
  en: {
    title: 'Clinical Appointment',
    subtitle: 'Book a doctor at the Park Lane clinic.',
    signIn: 'Sign in to book: clinic visits are saved to your Health Passport.',
    signInAction: 'Sign in',
    notConfigured: 'This build has no clinic server address (EXPO_PUBLIC_DEVICE_BACKEND_URL).',
    search: 'Search doctors or specialties',
    specialties: 'Specialty',
    all: 'All',
    doctors: (count: number) => (count === 1 ? '1 doctor' : `${count} doctors`),
    years: (count: number) => `${count} years’ experience`,
    minutes: (count: number) => `${count} min`,
    noDoctors: 'No doctors match. Try another specialty or name.',
    mine: 'My appointments',
    upcoming: 'Upcoming',
    past: 'Past visits',
    none: 'You have no appointments yet.',
    at: (date: string, time: string) => `${date}, ${time}`,
    for: (name: string) => `For ${name}`,
    visitRecord: 'Visit record in Health Passport',
  },
  ar: {
    title: 'حجز موعد طبي',
    subtitle: 'احجز موعدًا مع طبيب في عيادة بارك لين.',
    signIn: 'سجّل الدخول للحجز: تُحفظ زيارات العيادة في جوازك الصحي.',
    signInAction: 'تسجيل الدخول',
    notConfigured: 'لا يوجد عنوان لخادم العيادة في هذا الإصدار (EXPO_PUBLIC_DEVICE_BACKEND_URL).',
    search: 'ابحث عن طبيب أو تخصص',
    specialties: 'التخصص',
    all: 'الكل',
    doctors: (count: number) => (count === 1 ? 'طبيب واحد' : `${num(count, 'ar')} أطباء`),
    years: (count: number) => `خبرة ${num(count, 'ar')} سنة`,
    minutes: (count: number) => `${num(count, 'ar')} دقيقة`,
    noDoctors: 'لا يوجد أطباء مطابقون. جرّب تخصصًا أو اسمًا آخر.',
    mine: 'مواعيدي',
    upcoming: 'القادمة',
    past: 'الزيارات السابقة',
    none: 'لا توجد لديك مواعيد بعد.',
    at: (date: string, time: string) => `${date}، ${time}`,
    for: (name: string) => `لـ${name}`,
    visitRecord: 'سجل الزيارة في الجواز الصحي',
  },
} satisfies Record<HealthLang, unknown>;

/** The search waits this long after typing stops before asking the server. */
export const SEARCH_DELAY_MS = 300;

/** The specialty chips' "All". */
export const ALL = 'all';
