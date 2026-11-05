import type Ionicons from '@expo/vector-icons/Ionicons';

import type { HealthLang } from '../../../types/health.types';

export interface DataUsePoint {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
}

/**
 * How Health Passport uses data, in plain language. Shown before consent
 * and again, word for word, in Health Passport settings.
 */
export const dataUsePoints: Record<HealthLang, readonly DataUsePoint[]> = {
  en: [
    {
      icon: 'document-text-outline',
      title: 'What we keep',
      body: 'Your medical records as text: allergies, medications, conditions, lab results, procedures and visits, for you and the family members you add.',
    },
    {
      icon: 'scan-outline',
      title: 'How documents are read',
      body: 'When you upload a photo or PDF, AI on Parklane’s own servers reads it. You check every item before anything is saved, and originals may be deleted once you’ve confirmed them.',
    },
    {
      icon: 'mic-outline',
      title: 'Summaries for your doctor',
      body: 'Only you can create a spoken summary of your record, each time you ask for one. It is made on our servers from what you have saved.',
    },
    {
      icon: 'trash-outline',
      title: 'You stay in control',
      body: 'Edit or delete any item or document, or delete all of your health data, at any time from Health Passport settings.',
    },
    {
      icon: 'information-circle-outline',
      title: 'Not medical advice',
      body: 'Health Passport keeps and reads out your records. It does not diagnose or give medical advice.',
    },
  ],
  ar: [
    {
      icon: 'document-text-outline',
      title: 'ما الذي نحفظه',
      body: 'سجلاتك الطبية كنص: الحساسية والأدوية والأمراض ونتائج التحاليل والعمليات والزيارات، لك ولأفراد العائلة الذين تضيفهم.',
    },
    {
      icon: 'scan-outline',
      title: 'كيف تُقرأ المستندات',
      body: 'عند رفع صورة أو ملف PDF، يقرؤه الذكاء الاصطناعي على خوادم Parklane الخاصة. تراجع أنت كل عنصر قبل حفظ أي شيء، وقد تُحذف الملفات الأصلية بعد تأكيدها.',
    },
    {
      icon: 'mic-outline',
      title: 'ملخصات لطبيبك',
      body: 'أنت وحدك من يمكنه إنشاء ملخص صوتي لسجلك، في كل مرة تطلبه. يُعد الملخص على خوادمنا مما حفظته.',
    },
    {
      icon: 'trash-outline',
      title: 'التحكم بيدك',
      body: 'عدّل أو احذف أي عنصر أو مستند، أو احذف كل بياناتك الصحية في أي وقت من إعدادات جواز السفر الصحي.',
    },
    {
      icon: 'information-circle-outline',
      title: 'ليس نصيحة طبية',
      body: 'يحفظ جواز السفر الصحي سجلاتك ويقرؤها. ولا يقدم تشخيصًا أو نصيحة طبية.',
    },
  ],
};
