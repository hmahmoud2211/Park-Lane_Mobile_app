/**
 * Health Passport wording shared across its screens, in English and Arabic,
 * the way the visitor pass does it (services/parking/i18n): one table per
 * language, Arabic-Indic digits in Arabic, and record data (drug names,
 * doses, test names) left exactly as entered or read from the document.
 * Each screen keeps its own copy in its `.data.ts`.
 */
import { digitsIn } from '../parking/i18n';
import type {
  BloodType,
  ConditionStatus,
  DocumentStatus,
  DocumentType,
  HealthLang,
  RecordSection,
  Relation,
  Severity,
  Sex,
} from './health.types';
import type { HealthErrorKind } from './healthService';

export { deviceLang } from '../parking/i18n';

const EN_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

/** Numbers and figures in the reader's digits. */
export const num = (value: string | number, lang: HealthLang) => digitsIn(value, lang);

/** "14 Mar 1968", or "١٤ مارس ١٩٦٨". A plain date never shifts with the time zone. */
export function formatDate(value: string | null | undefined, lang: HealthLang): string {
  if (!value) return '';
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = plain ? null : new Date(value);
  const year = plain ? Number(plain[1]) : date!.getFullYear();
  const month = plain ? Number(plain[2]) - 1 : date!.getMonth();
  const day = plain ? Number(plain[3]) : date!.getDate();
  if (!Number.isFinite(year)) return value;
  return lang === 'ar' ? num(`${day} ${AR_MONTHS[month]} ${year}`, 'ar') : `${day} ${EN_MONTHS[month]} ${year}`;
}

/** "26 Oct 2026, 09:00", in the phone's own time zone. */
export function formatDateTime(value: string, lang: HealthLang): string {
  const date = new Date(value);
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
  return `${formatDate(value, lang)}${lang === 'ar' ? '، ' : ', '}${num(time, lang)}`;
}

/** "1:05", for the audio player. */
export function formatClock(seconds: number, lang: HealthLang): string {
  const whole = Math.max(0, Math.floor(seconds || 0));
  return num(`${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`, lang);
}

const RTL_CHAR = /[֐-ࣿיִ-﷿ﹰ-﻿]/;
const LTR_CHAR = /[A-Za-zÀ-ɏ]/;

/**
 * The direction a piece of data reads in, from its first letter: an English
 * transcript inside the Arabic UI stays left-to-right, an Arabic one in the
 * English UI right-to-left. Text with no letters follows the UI.
 */
export function textDirection(text: string | null | undefined, fallback: HealthLang): 'ltr' | 'rtl' {
  for (const char of text ?? '') {
    if (RTL_CHAR.test(char)) return 'rtl';
    if (LTR_CHAR.test(char)) return 'ltr';
  }
  return fallback === 'ar' ? 'rtl' : 'ltr';
}

/** Doctor specialties the summary can be tailored for; sent to the backend as these keys. */
export const SPECIALTIES = [
  'general',
  'internal_medicine',
  'cardiology',
  'endocrinology',
  'pediatrics',
  'orthopedics',
  'neurology',
  'gastroenterology',
  'dermatology',
  'gynecology',
  'ophthalmology',
  'ent',
  'urology',
  'psychiatry',
  'pulmonology',
] as const;

export type Specialty = (typeof SPECIALTIES)[number];

export interface HealthStrings {
  featureName: string;
  /** The other language, named in itself, for the header toggle. */
  switchLabel: string;
  switchA11y: string;
  /** Each section's tab title and the name of one item in it. */
  sections: Record<RecordSection, { title: string; one: string; add: string; empty: string }>;
  documentsTab: string;
  documentType: Record<DocumentType, string>;
  documentStatus: Record<DocumentStatus, string>;
  severity: Record<Severity, string>;
  conditionStatus: Record<ConditionStatus, string>;
  sex: Record<Sex, string>;
  relation: Record<Relation, string>;
  bloodType: (value: BloodType | null) => string;
  specialty: Record<Specialty, string>;
  fields: {
    substance: string;
    reaction: string;
    severity: string;
    name: string;
    dose: string;
    frequency: string;
    start: string;
    end: string;
    stillTaking: string;
    diagnosed: string;
    yearDiagnosed: string;
    status: string;
    date: string;
    test: string;
    value: string;
    unit: string;
    refLow: string;
    refHigh: string;
    normalRange: string;
    specialty: string;
    reason: string;
  };
  sourceManual: string;
  sourceDocument: (type: string, date: string) => string;
  sinceDate: (date: string) => string;
  untilDate: (date: string) => string;
  aboveRange: string;
  belowRange: string;
  current: string;
  past: string;
  actions: {
    save: string;
    cancel: string;
    delete: string;
    edit: string;
    remove: string;
    retry: string;
    confirm: string;
    close: string;
    back: string;
    continue: string;
  };
  loading: string;
  errors: Record<HealthErrorKind, { title: string; body: string }>;
  /** Date picker: the empty field, clearing an optional date, and closing the iOS sheet. */
  pickDate: string;
  clearDate: string;
  done: string;
}

const en: HealthStrings = {
  featureName: 'Health Passport',
  switchLabel: 'عربي',
  switchA11y: 'اعرض باللغة العربية',
  sections: {
    allergies: { title: 'Allergies', one: 'Allergy', add: 'Add allergy', empty: 'No allergies recorded.' },
    medications: { title: 'Medications', one: 'Medication', add: 'Add medication', empty: 'No medications recorded.' },
    conditions: { title: 'Conditions', one: 'Condition', add: 'Add condition', empty: 'No conditions recorded.' },
    labs: { title: 'Lab results', one: 'Lab result', add: 'Add lab result', empty: 'No lab results recorded.' },
    procedures: { title: 'Procedures', one: 'Procedure', add: 'Add procedure', empty: 'No procedures recorded.' },
    visits: { title: 'Visits', one: 'Visit', add: 'Add visit', empty: 'No visits recorded.' },
  },
  documentsTab: 'Documents',
  documentType: {
    prescription: 'Prescription',
    lab_report: 'Lab report',
    discharge_summary: 'Discharge summary',
    imaging_report: 'Imaging report',
    other: 'Other document',
  },
  documentStatus: {
    processing: 'Processing',
    needs_review: 'Needs review',
    confirmed: 'Confirmed',
    failed: 'Failed',
  },
  severity: { mild: 'Mild', moderate: 'Moderate', severe: 'Severe' },
  conditionStatus: { active: 'Active', resolved: 'Resolved' },
  sex: { male: 'Male', female: 'Female' },
  relation: { self: 'You', child: 'Child', parent: 'Parent', spouse: 'Spouse', other: 'Family member' },
  bloodType: (value) => value ?? 'Unknown',
  specialty: {
    general: 'General',
    internal_medicine: 'Internal medicine',
    cardiology: 'Cardiology',
    endocrinology: 'Endocrinology',
    pediatrics: 'Pediatrics',
    orthopedics: 'Orthopedics',
    neurology: 'Neurology',
    gastroenterology: 'Gastroenterology',
    dermatology: 'Dermatology',
    gynecology: 'Gynecology',
    ophthalmology: 'Ophthalmology',
    ent: 'Ear, nose & throat',
    urology: 'Urology',
    psychiatry: 'Psychiatry',
    pulmonology: 'Chest & lungs',
  },
  fields: {
    substance: 'Substance',
    reaction: 'Reaction',
    severity: 'Severity',
    name: 'Name',
    dose: 'Dose',
    frequency: 'How often',
    start: 'Started',
    end: 'Stopped',
    stillTaking: 'Still taking it',
    diagnosed: 'Diagnosed',
    yearDiagnosed: 'Year diagnosed',
    status: 'Status',
    date: 'Date',
    test: 'Test',
    value: 'Value',
    unit: 'Unit',
    refLow: 'Normal from',
    refHigh: 'Normal up to',
    normalRange: 'Normal range',
    specialty: 'Specialty',
    reason: 'Reason',
  },
  sourceManual: 'Added manually',
  sourceDocument: (type, date) => (date ? `From ${type.toLowerCase()} · ${date}` : `From ${type.toLowerCase()}`),
  sinceDate: (date) => `Since ${date}`,
  untilDate: (date) => `Until ${date}`,
  aboveRange: 'Above normal range',
  belowRange: 'Below normal range',
  current: 'Current',
  past: 'Past',
  actions: {
    save: 'Save',
    cancel: 'Cancel',
    delete: 'Delete',
    edit: 'Edit',
    remove: 'Remove',
    retry: 'Try again',
    confirm: 'Confirm',
    close: 'Close',
    back: 'Back',
    continue: 'Continue',
  },
  loading: 'Loading…',
  errors: {
    network: { title: 'No connection', body: 'Check your internet connection and try again.' },
    timeout: { title: 'This is taking too long', body: 'The server didn’t answer in time. Try again.' },
    aborted: { title: 'Cancelled', body: 'Nothing was changed.' },
    unauthorized: { title: 'Your session has ended', body: 'Please sign in again.' },
    not_found: { title: 'Not found', body: 'This may have been deleted.' },
    too_large: { title: 'File too large', body: 'Each file must be 10 MB or smaller. Try a smaller photo or PDF.' },
    invalid: { title: 'Some details aren’t valid', body: 'Check the details and try again.' },
    busy: {
      title: 'The health assistant is busy',
      body: 'Our server is busy or unavailable right now. Try again in a minute.',
    },
    server: { title: 'Something went wrong', body: 'Try again in a moment.' },
  },
  pickDate: 'Choose a date',
  clearDate: 'Clear date',
  done: 'Done',
};

const ar: HealthStrings = {
  featureName: 'جواز السفر الصحي',
  switchLabel: 'EN',
  switchA11y: 'Show in English',
  sections: {
    allergies: { title: 'الحساسية', one: 'حساسية', add: 'إضافة حساسية', empty: 'لا توجد حساسية مسجلة.' },
    medications: { title: 'الأدوية', one: 'دواء', add: 'إضافة دواء', empty: 'لا توجد أدوية مسجلة.' },
    conditions: { title: 'الأمراض', one: 'حالة مرضية', add: 'إضافة حالة مرضية', empty: 'لا توجد أمراض مسجلة.' },
    labs: { title: 'التحاليل', one: 'نتيجة تحليل', add: 'إضافة نتيجة تحليل', empty: 'لا توجد نتائج تحاليل مسجلة.' },
    procedures: { title: 'العمليات', one: 'عملية', add: 'إضافة عملية', empty: 'لا توجد عمليات مسجلة.' },
    visits: { title: 'الزيارات', one: 'زيارة', add: 'إضافة زيارة', empty: 'لا توجد زيارات مسجلة.' },
  },
  documentsTab: 'المستندات',
  documentType: {
    prescription: 'روشتة',
    lab_report: 'تقرير تحاليل',
    discharge_summary: 'ملخص خروج من المستشفى',
    imaging_report: 'تقرير أشعة',
    other: 'مستند آخر',
  },
  documentStatus: {
    processing: 'جارٍ القراءة',
    needs_review: 'بحاجة للمراجعة',
    confirmed: 'تم التأكيد',
    failed: 'تعذّرت القراءة',
  },
  severity: { mild: 'بسيطة', moderate: 'متوسطة', severe: 'شديدة' },
  conditionStatus: { active: 'نشطة', resolved: 'تم الشفاء' },
  sex: { male: 'ذكر', female: 'أنثى' },
  relation: { self: 'أنت', child: 'ابن/ابنة', parent: 'والد/والدة', spouse: 'زوج/زوجة', other: 'فرد من العائلة' },
  bloodType: (value) => value ?? 'غير معروفة',
  specialty: {
    general: 'عام',
    internal_medicine: 'باطنة',
    cardiology: 'قلب',
    endocrinology: 'غدد صماء',
    pediatrics: 'أطفال',
    orthopedics: 'عظام',
    neurology: 'مخ وأعصاب',
    gastroenterology: 'جهاز هضمي',
    dermatology: 'جلدية',
    gynecology: 'نساء وتوليد',
    ophthalmology: 'عيون',
    ent: 'أنف وأذن وحنجرة',
    urology: 'مسالك بولية',
    psychiatry: 'طب نفسي',
    pulmonology: 'صدر',
  },
  fields: {
    substance: 'المادة',
    reaction: 'رد الفعل',
    severity: 'الشدة',
    name: 'الاسم',
    dose: 'الجرعة',
    frequency: 'عدد المرات',
    start: 'تاريخ البدء',
    end: 'تاريخ التوقف',
    stillTaking: 'ما زلت أتناوله',
    diagnosed: 'تاريخ التشخيص',
    yearDiagnosed: 'سنة التشخيص',
    status: 'الحالة',
    date: 'التاريخ',
    test: 'التحليل',
    value: 'القيمة',
    unit: 'الوحدة',
    refLow: 'الطبيعي من',
    refHigh: 'الطبيعي حتى',
    normalRange: 'المعدل الطبيعي',
    specialty: 'التخصص',
    reason: 'السبب',
  },
  sourceManual: 'أُضيف يدويًا',
  sourceDocument: (type, date) => (date ? `من ${type} · ${date}` : `من ${type}`),
  sinceDate: (date) => `منذ ${date}`,
  untilDate: (date) => `حتى ${date}`,
  aboveRange: 'أعلى من المعدل الطبيعي',
  belowRange: 'أقل من المعدل الطبيعي',
  current: 'الحالية',
  past: 'السابقة',
  actions: {
    save: 'حفظ',
    cancel: 'إلغاء',
    delete: 'حذف',
    edit: 'تعديل',
    remove: 'إزالة',
    retry: 'حاول مرة أخرى',
    confirm: 'تأكيد',
    close: 'إغلاق',
    back: 'رجوع',
    continue: 'متابعة',
  },
  loading: 'جارٍ التحميل…',
  errors: {
    network: { title: 'لا يوجد اتصال', body: 'تحقق من اتصالك بالإنترنت ثم حاول مرة أخرى.' },
    timeout: { title: 'استغرق الأمر وقتًا طويلًا', body: 'لم يرد الخادم في الوقت المحدد. حاول مرة أخرى.' },
    aborted: { title: 'تم الإلغاء', body: 'لم يتغير شيء.' },
    unauthorized: { title: 'انتهت جلستك', body: 'يرجى تسجيل الدخول مرة أخرى.' },
    not_found: { title: 'غير موجود', body: 'ربما تم حذفه.' },
    too_large: { title: 'الملف كبير جدًا', body: 'يجب ألا يزيد حجم كل ملف عن ١٠ ميجابايت. جرّب صورة أو ملف PDF أصغر.' },
    invalid: { title: 'بعض البيانات غير صحيحة', body: 'راجع البيانات ثم حاول مرة أخرى.' },
    busy: { title: 'المساعد الصحي مشغول', body: 'الخادم مشغول أو غير متاح الآن. حاول مرة أخرى بعد دقيقة.' },
    server: { title: 'حدث خطأ ما', body: 'حاول مرة أخرى بعد قليل.' },
  },
  pickDate: 'اختر تاريخًا',
  clearDate: 'مسح التاريخ',
  done: 'تم',
};

export const healthStrings: Record<HealthLang, HealthStrings> = { en, ar };
