import type { Lang } from '../../services/parking/i18n';

/** The map page's own words. Arabic only reaches it from a guest's pass. */
export interface MapCopy {
  title: string;
  gpsNote: string;
  outdoorNote: string;
  fictional: string;
  notFound: string;
  enterBy: (gate: string) => string;
  navigateTo: (gate: string) => string;
  navigateHint: string;
}

const en: MapCopy = {
  title: 'Find Your Space',
  gpsNote:
    'The map shows the compound’s layout, not your live position: phone GPS cannot place you in a basement. Follow the level signs and the glowing route on the map.',
  outdoorNote: 'Your maps app can guide you to the gate; inside, follow the glowing route on the map.',
  fictional: 'Demo layout and gate coordinates are fictional.',
  notFound: 'There is no space to show for this link.',
  enterBy: (gate) => `enter by ${gate}`,
  navigateTo: (gate) => `Navigate to ${gate}`,
  navigateHint: 'Opens your maps app with directions to the vehicle entrance',
};

const ar: MapCopy = {
  title: 'اعثر على موقفك',
  gpsNote:
    'تعرض الخريطة تخطيط الكمبوند وليس موقعك المباشر: لا يستطيع GPS الهاتف تحديد مكانك في البدروم. اتبع لافتات الأدوار والمسار المضيء على الخريطة.',
  outdoorNote: 'يمكن لتطبيق الخرائط إرشادك إلى البوابة؛ وفي الداخل اتبع المسار المضيء على الخريطة.',
  fictional: 'التخطيط وإحداثيات البوابات في هذا العرض التجريبي غير حقيقية.',
  notFound: 'لا يوجد موقف لعرضه لهذا الرابط.',
  enterBy: (gate) => `الدخول من ${gate}`,
  navigateTo: (gate) => `الطريق إلى ${gate}`,
  navigateHint: 'يفتح تطبيق الخرائط بالاتجاهات إلى مدخل السيارات',
};

export const mapCopy: Record<Lang, MapCopy> = { en, ar };
