import type Ionicons from '@expo/vector-icons/Ionicons';

import type { DocumentStatus, DocumentType, HealthDocument, HealthLang, HealthProfile, RecordSection } from '../../services/health/health.types';
import { formatDate, healthStrings, num } from '../../services/health/i18n';
import type { StatusTone } from '../ui/StatusChip';

/**
 * Icons, chip tones and short labels shared by the Health Passport screens,
 * as components/parking/presenters does for parking.
 */

export const sectionIcon: Record<RecordSection, keyof typeof Ionicons.glyphMap> = {
  allergies: 'warning-outline',
  medications: 'medical-outline',
  conditions: 'pulse-outline',
  labs: 'flask-outline',
  procedures: 'bandage-outline',
  visits: 'calendar-outline',
};

export const documentIcon: Record<DocumentType, keyof typeof Ionicons.glyphMap> = {
  prescription: 'receipt-outline',
  lab_report: 'flask-outline',
  discharge_summary: 'business-outline',
  imaging_report: 'scan-outline',
  other: 'document-outline',
};

export const statusTone: Record<DocumentStatus, StatusTone> = {
  processing: 'slate',
  needs_review: 'amber',
  confirmed: 'teal',
  failed: 'red',
};

/** Whole years, from a `YYYY-MM-DD` birth date. */
export function ageOf(dateOfBirth: string | null, now = new Date()): number | null {
  if (!dateOfBirth) return null;
  const [year, month, day] = dateOfBirth.split('-').map(Number);
  let age = now.getFullYear() - year;
  if (now.getMonth() + 1 < month || (now.getMonth() + 1 === month && now.getDate() < day)) age -= 1;
  return age >= 0 ? age : null;
}

/** "Male · 58 years · Blood type unknown". */
export function profileLine(profile: HealthProfile, lang: HealthLang): string {
  const t = healthStrings[lang];
  const age = ageOf(profile.date_of_birth);
  const parts = [
    profile.sex ? t.sex[profile.sex] : '',
    age !== null ? (lang === 'ar' ? `${num(age, 'ar')} سنة` : `${age} years`) : '',
    lang === 'ar' ? `فصيلة الدم: ${t.bloodType(profile.blood_type)}` : `Blood type: ${t.bloodType(profile.blood_type)}`,
  ];
  return parts.filter(Boolean).join(' · ');
}

/** "Prescription · uploaded 26 Oct 2026". */
export function documentLines(doc: HealthDocument, lang: HealthLang): string[] {
  const uploaded = formatDate(doc.uploaded_at, lang);
  const lines = [lang === 'ar' ? `رُفع في ${uploaded}` : `Uploaded ${uploaded}`];
  if (doc.document_date) {
    lines.push(lang === 'ar' ? `بتاريخ ${formatDate(doc.document_date, lang)}` : `Dated ${formatDate(doc.document_date, lang)}`);
  }
  return lines;
}
