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
      body: 'When you upload a photo or PDF, it is sent to an outside AI service (Google Gemini or Anthropic Claude) to read it. You check every item before anything is saved, and originals may be deleted once you’ve confirmed them.',
    },
    {
      icon: 'mic-outline',
      title: 'Summaries for your doctor',
      body: 'Only you, and anyone you share a record with, can create a spoken summary of it, each time one is asked for. To make it, the saved record is sent to that AI service, and the text to ElevenLabs to read it aloud.',
    },
    {
      icon: 'people-outline',
      title: 'Sharing with your family',
      body: 'Nobody else sees your records unless you share one with someone who lives in your apartment, to view or to edit. You can stop at any time, and it stops by itself if either of you moves out.',
    },
    {
      icon: 'trash-outline',
      title: 'You stay in control',
      body: 'Edit or delete any item or document, or delete all of your health data, at any time from Health Passport settings.',
    },
    {
      icon: 'information-circle-outline',
      title: 'Not medical advice',
      body: 'Health Passport keeps and reads out your records. It is not a medical device and does not diagnose, treat or give medical advice. AI can make mistakes, so always ask a doctor or pharmacist before making a medical decision.',
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
      body: 'عند رفع صورة أو ملف PDF، يُرسل إلى خدمة ذكاء اصطناعي خارجية (Google Gemini أو Anthropic Claude) لقراءته. تراجع أنت كل عنصر قبل حفظ أي شيء، وقد تُحذف الملفات الأصلية بعد تأكيدها.',
    },
    {
      icon: 'mic-outline',
      title: 'ملخصات لطبيبك',
      body: 'أنت ومن تشاركه سجلًا فقط يمكنكم إنشاء ملخص صوتي له، في كل مرة يُطلب. لإعداده يُرسل السجل المحفوظ إلى خدمة الذكاء الاصطناعي نفسها، ويُرسل النص إلى ElevenLabs لقراءته بصوت.',
    },
    {
      icon: 'people-outline',
      title: 'المشاركة مع عائلتك',
      body: 'لا يرى أحد سجلاتك إلا إذا شاركت سجلًا مع شخص يسكن معك في الشقة، للعرض أو للتعديل. يمكنك إيقاف المشاركة في أي وقت، وتتوقف تلقائيًا إذا غادر أحدكما الشقة.',
    },
    {
      icon: 'trash-outline',
      title: 'التحكم بيدك',
      body: 'عدّل أو احذف أي عنصر أو مستند، أو احذف كل بياناتك الصحية في أي وقت من إعدادات جواز السفر الصحي.',
    },
    {
      icon: 'information-circle-outline',
      title: 'ليس نصيحة طبية',
      body: 'يحفظ جواز السفر الصحي سجلاتك ويقرؤها. وهو ليس جهازًا طبيًا ولا يقدم تشخيصًا أو علاجًا أو نصيحة طبية. قد يخطئ الذكاء الاصطناعي، لذا راجع طبيبًا أو صيدليًا دائمًا قبل اتخاذ أي قرار طبي.',
    },
  ],
};
