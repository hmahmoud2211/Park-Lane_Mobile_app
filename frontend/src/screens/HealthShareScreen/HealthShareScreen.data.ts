import type { HealthLang } from '../../types/health.types';

export const shareCopy = {
  en: {
    title: (name: string) => `Share ${name}’s record`,
    titleOwn: 'Share your record',
    titleAny: 'Share a record',
    subtitle: 'With people who live in your apartment',
    sharedWith: 'Shared with',
    sharedWithHint: 'Tap a person to change what they can do, or to stop sharing.',
    nobodyYet: 'Only you can see this record.',
    shareWith: 'Share with',
    shareWithHint: 'Each person signs in with their own Parklane account.',
    noMembers:
      'Nobody else in your apartment has a Parklane account yet. An owner can invite family from Smart Home → My Devices → Gateway settings → Invite family.',
    noApartment:
      'Your account isn’t linked to an apartment yet, so there is nobody to share with. Records can only be shared with people who live with you.',
    howTitle: 'How sharing works',
    how: [
      { icon: 'eye-outline', title: 'View only', body: 'They can read the record and its documents, and play a summary for a doctor.' },
      {
        icon: 'create-outline',
        title: 'View and edit',
        body: 'They can also add or change items, upload documents, and book clinic visits for this person.',
      },
      { icon: 'lock-closed-outline', title: 'You stay in charge', body: 'Only you can delete this record or choose who sees it.' },
      {
        icon: 'exit-outline',
        title: 'When it ends',
        body: 'When you stop it, when they remove it, or when either of you leaves the apartment.',
      },
    ],
    chooseTitle: (name: string) => `What can ${name} do?`,
    changeTitle: (name: string) => `Sharing with ${name}`,
    viewOnly: 'View only',
    viewAndEdit: 'View and edit',
    stop: 'Stop sharing',
    since: (date: string) => `Since ${date}`,
  },
  ar: {
    title: (name: string) => `مشاركة سجل ${name}`,
    titleOwn: 'مشاركة سجلك',
    titleAny: 'مشاركة سجل',
    subtitle: 'مع من يسكنون معك في الشقة',
    sharedWith: 'مُشارَك مع',
    sharedWithHint: 'اضغط على الشخص لتغيير ما يمكنه فعله، أو لإيقاف المشاركة.',
    nobodyYet: 'أنت وحدك ترى هذا السجل.',
    shareWith: 'مشاركة مع',
    shareWithHint: 'يدخل كل شخص بحسابه الخاص في Parklane.',
    noMembers:
      'لا يوجد أحد غيرك في شقتك لديه حساب في Parklane بعد. يمكن للمالك دعوة العائلة من المنزل الذكي ← أجهزتي ← إعدادات البوابة ← دعوة العائلة.',
    noApartment: 'حسابك غير مرتبط بشقة بعد، لذلك لا يوجد من تشاركه. تتم مشاركة السجلات فقط مع من يسكنون معك.',
    howTitle: 'كيف تعمل المشاركة',
    how: [
      { icon: 'eye-outline', title: 'عرض فقط', body: 'يمكنه قراءة السجل ومستنداته، وتشغيل ملخص للطبيب.' },
      { icon: 'create-outline', title: 'عرض وتعديل', body: 'يمكنه أيضًا إضافة العناصر أو تعديلها، ورفع المستندات، وحجز مواعيد العيادة لهذا الشخص.' },
      { icon: 'lock-closed-outline', title: 'القرار لك', body: 'أنت وحدك يمكنك حذف هذا السجل أو اختيار من يراه.' },
      { icon: 'exit-outline', title: 'متى تنتهي', body: 'عندما توقفها، أو عندما يزيله هو، أو عندما يغادر أحدكما الشقة.' },
    ],
    chooseTitle: (name: string) => `ماذا يمكن لـ${name} أن يفعل؟`,
    changeTitle: (name: string) => `المشاركة مع ${name}`,
    viewOnly: 'عرض فقط',
    viewAndEdit: 'عرض وتعديل',
    stop: 'إيقاف المشاركة',
    since: (date: string) => `منذ ${date}`,
  },
} as const satisfies Record<HealthLang, unknown>;
