import type { HealthLang } from '../../services/health/health.types';

export const itemFormCopy = {
  en: {
    addTitle: 'Add item',
    editTitle: (one: string) => `Edit ${one.toLowerCase()}`,
    subtitle: 'Enter it as written on the prescription or report.',
    sectionLabel: 'What are you adding?',
    save: 'Save',
    notFound: 'This item is no longer in the record.',
  },
  ar: {
    addTitle: 'إضافة عنصر',
    editTitle: (one: string) => `تعديل ${one}`,
    subtitle: 'أدخله كما هو مكتوب في الروشتة أو التقرير.',
    sectionLabel: 'ماذا تضيف؟',
    save: 'حفظ',
    notFound: 'لم يعد هذا العنصر موجودًا في السجل.',
  },
} satisfies Record<HealthLang, unknown>;
