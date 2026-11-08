import { num } from '../../features/health/services/i18n';
import type { HealthLang } from '../../types/health.types';

/** "شخصين", "٣ أشخاص", "١١ شخصًا": Arabic counts take a different word by number. */
function arabicPeople(n: number) {
  if (n === 1) return 'شخص واحد';
  if (n === 2) return 'شخصين';
  return n <= 10 ? `${num(n, 'ar')} أشخاص` : `${num(n, 'ar')} شخصًا`;
}

export const settingsCopy = {
  en: {
    title: 'Settings & privacy',
    subtitle: 'Health Passport',
    family: 'Family profiles',
    familyHint: 'Records you keep for your children, parents or others.',
    addFamily: 'Add family member',
    share: 'Share with your family',
    shareHint: 'Let people who live with you see a record, or help keep it up to date.',
    sharedCount: (n: number) => (n === 1 ? 'Shared with 1 person' : `Shared with ${n} people`),
    onlyYou: 'Only you',
    sharedWithYou: 'Shared with you',
    sharedWithYouHint: 'Records other people in your apartment share with you.',
    leaveTitle: (name: string) => `Stop seeing ${name}’s record?`,
    leaveBody: (keeper: string) => `It leaves your Health Passport. ${keeper} can share it with you again.`,
    leaveConfirm: 'Stop seeing it',
    dataUse: 'How your data is used',
    deleteData: 'Delete health data',
    deleteDataHint: 'Removes everything recorded for one person: items, documents and summaries.',
    deleteFor: (name: string) => `Delete all health data for ${name}`,
    deleteTitle: (name: string) => `Delete all health data for ${name}?`,
    deleteBody: 'Every item, document, original file and summary for this person will be deleted. This can’t be undone.',
    deleteProfileTitle: (name: string) => `Remove ${name}?`,
    deleteProfileBody: 'Their profile and all of their health data will be deleted. This can’t be undone.',
    typeName: (name: string) => `Type “${name}” to confirm`,
    deleteConfirm: 'Delete permanently',
    remove: (name: string) => `Remove ${name}`,
    withdraw: 'Withdraw consent',
    withdrawHint: 'Stops Health Passport and deletes all health data for you and your family.',
    withdrawTitle: 'Withdraw consent and delete everything?',
    withdrawBody:
      'All health data for every profile, including documents, originals and summaries, will be deleted, and Health Passport will be locked until you agree again. This can’t be undone.',
    withdrawWord: 'DELETE',
    typeWord: (word: string) => `Type ${word} to confirm`,
    withdrawConfirm: 'Withdraw and delete',
    edit: 'Edit',
  },
  ar: {
    title: 'الإعدادات والخصوصية',
    subtitle: 'جواز السفر الصحي',
    family: 'ملفات العائلة',
    familyHint: 'سجلات تحتفظ بها لأطفالك أو والديك أو غيرهم.',
    addFamily: 'إضافة فرد من العائلة',
    share: 'المشاركة مع عائلتك',
    shareHint: 'اسمح لمن يسكنون معك برؤية سجل، أو بالمساعدة في تحديثه.',
    sharedCount: (n: number) => `مُشارَك مع ${arabicPeople(n)}`,
    onlyYou: 'أنت فقط',
    sharedWithYou: 'مُشارَك معك',
    sharedWithYouHint: 'سجلات يشاركها معك آخرون في شقتك.',
    leaveTitle: (name: string) => `إيقاف عرض سجل ${name}؟`,
    leaveBody: (keeper: string) => `سيُزال من جوازك الصحي. يمكن لـ${keeper} مشاركته معك مرة أخرى.`,
    leaveConfirm: 'إيقاف العرض',
    dataUse: 'كيف نستخدم بياناتك',
    deleteData: 'حذف البيانات الصحية',
    deleteDataHint: 'يحذف كل ما سُجل لشخص واحد: العناصر والمستندات والملخصات.',
    deleteFor: (name: string) => `حذف كل البيانات الصحية لـ${name}`,
    deleteTitle: (name: string) => `حذف كل البيانات الصحية لـ${name}؟`,
    deleteBody: 'ستُحذف كل العناصر والمستندات والملفات الأصلية والملخصات لهذا الشخص. لا يمكن التراجع عن ذلك.',
    deleteProfileTitle: (name: string) => `إزالة ${name}؟`,
    deleteProfileBody: 'سيُحذف ملفه وكل بياناته الصحية. لا يمكن التراجع عن ذلك.',
    typeName: (name: string) => `اكتب «${name}» للتأكيد`,
    deleteConfirm: 'حذف نهائي',
    remove: (name: string) => `إزالة ${name}`,
    withdraw: 'سحب الموافقة',
    withdrawHint: 'يوقف جواز السفر الصحي ويحذف كل البيانات الصحية لك ولعائلتك.',
    withdrawTitle: 'سحب الموافقة وحذف كل شيء؟',
    withdrawBody:
      'ستُحذف كل البيانات الصحية لكل الملفات، بما فيها المستندات والملفات الأصلية والملخصات، وسيُقفل جواز السفر الصحي حتى توافق مرة أخرى. لا يمكن التراجع عن ذلك.',
    withdrawWord: 'حذف',
    typeWord: (word: string) => `اكتب «${word}» للتأكيد`,
    withdrawConfirm: 'سحب وحذف',
    edit: 'تعديل',
  },
} satisfies Record<HealthLang, unknown>;
