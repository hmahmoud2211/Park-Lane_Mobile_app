import type { HealthLang } from '../../services/health/health.types';
import { RECORD_SECTIONS } from '../../services/health/health.types';
import { num } from '../../services/health/i18n';
import type { RecordTab } from '../../types/navigation.types';

export const RECORD_TABS: readonly RecordTab[] = [...RECORD_SECTIONS, 'documents'];

export const recordsCopy = {
  en: {
    title: 'Records',
    tabsLabel: 'Record sections',
    deleteTitle: (name: string) => `Delete “${name}”?`,
    deleteBody: 'It will be removed from the record and from future summaries. This can’t be undone.',
    unknownDocument: 'From a document',
    trend: (test: string) => `${test} trend, oldest to newest`,
    upload: 'Upload document',
    noDocuments: 'No documents yet.',
    results: (n: number) => (n === 1 ? '1 result' : `${n} results`),
  },
  ar: {
    title: 'السجلات',
    tabsLabel: 'أقسام السجل',
    deleteTitle: (name: string) => `حذف «${name}»؟`,
    deleteBody: 'سيُحذف من السجل ومن الملخصات القادمة. لا يمكن التراجع عن ذلك.',
    unknownDocument: 'من مستند',
    trend: (test: string) => `تطور ${test} من الأقدم إلى الأحدث`,
    upload: 'رفع مستند',
    noDocuments: 'لا توجد مستندات بعد.',
    results: (n: number) => (n === 1 ? 'نتيجة واحدة' : `${num(n, 'ar')} نتائج`),
  },
} satisfies Record<HealthLang, unknown>;

/** A trend line needs this many results to say anything. */
export const TREND_MIN_RESULTS = 3;
