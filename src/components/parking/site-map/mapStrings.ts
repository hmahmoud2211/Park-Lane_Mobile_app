import { digitsIn, gateNameIn, levelNameIn, nameIn, type Lang } from '../../../services/parking/i18n';
import type { LevelId } from '../../../services/parking/types';
import type { BayState, ChargerState } from './mapModel';

/**
 * Everything the site map writes, in English or Arabic. The map is shown in
 * Arabic only on a guest's pass; residents and security see English.
 */
export interface MapStrings {
  lang: Lang;
  name: (englishName: string) => string;
  level: (id: LevelId) => string;
  levelShort: (id: LevelId) => string;
  gate: (gateId: string) => string;
  exitOnly: string;
  rampDown: (to: LevelId) => [string, string];
  rampUp: string;
  lobby: string;
  /** Aisle labels carry an arrow in English; in Arabic the aisle arrows on the floor say it. */
  aisle: (label: string) => string;
  compass: string;
  youEnterHere: string;
  fromRamp: string;
  free: (free: number, total: number) => string;
  basementSummary: (free: number, total: number, ev: boolean) => string;
  /** Choosing a bay: free for the whole booked time, not just now. */
  freeForYourTime: (free: number, total: number, ev: boolean) => string;
  /** A level with nothing this booking can take, e.g. residents' own bays. */
  notBookable: string;
  /** The map card's overline, e.g. "5 available spots". */
  availableSpots: (n: number) => string;
  legend: {
    available: string;
    occupiedNow: string;
    unavailable: string;
    route: string;
    yourBay: string;
    selected: string;
    walk: string;
    gate: string;
    freeNow: string;
    occupied: string;
    reserved: string;
    chargerFree: string;
    inUse: string;
    fault: string;
  };
  walkingRoute: string;
  bayNumbers: string;
  dragHint: string;
  zoomIn: string;
  zoomOut: string;
  fit: string;
  close: string;
  goTo: (level: string) => string;
  bayDetails: (label: string) => string;
  chooseBay: (label: string, free: boolean) => string;
  chargerDetails: (label: string) => string;
  yourBay: string;
  freeForVisit: string;
  chargesAtOnce: (n: number) => string;
  bayState: Record<BayState, string>;
  chargerState: Record<ChargerState, string>;
  mapOf: (level: string) => string;
}

const en: MapStrings = {
  lang: 'en',
  name: (n) => n,
  level: (id) => levelNameIn(id, 'en'),
  levelShort: (id) => levelNameIn(id, 'en', true),
  gate: (id) => gateNameIn(id, 'en', true),
  exitOnly: 'exit only',
  rampDown: (to) => (to === 'b1' ? ['Ramp ↓ B1', 'EV Hub'] : ['Ramp ↓ B2', 'Residents']),
  rampUp: 'Ramp ↑ South Road',
  lobby: '↑ lobby',
  aisle: (label) => label,
  compass: 'N',
  youEnterHere: 'You enter here',
  fromRamp: 'From South Road',
  free: (free, total) => `${free}/${total} free`,
  basementSummary: (free, total, ev) => `${free} of ${total} ${ev ? 'EV bays' : 'bays'} free now`,
  freeForYourTime: (free, total, ev) => `${free} of ${total} ${ev ? 'EV bays' : 'bays'} free for your time`,
  notBookable: 'Not bookable for this visit',
  availableSpots: (n) => `${n} available ${n === 1 ? 'spot' : 'spots'}`,
  legend: {
    available: 'Available',
    occupiedNow: 'Occupied',
    unavailable: 'Unavailable',
    route: 'Route',
    yourBay: 'Your bay',
    selected: 'Selected',
    walk: 'Walk',
    gate: 'Gate',
    freeNow: 'Free now',
    occupied: 'Occupied',
    reserved: 'Reserved',
    chargerFree: 'Charger free',
    inUse: 'In use',
    fault: 'Fault',
  },
  walkingRoute: 'Walking route',
  bayNumbers: 'Bay numbers',
  dragHint: 'Drag to move around',
  zoomIn: 'Zoom in',
  zoomOut: 'Zoom out',
  fit: 'Show the whole level',
  close: 'Close details',
  goTo: (level) => `Go to ${level}`,
  bayDetails: (label) => `${label} details`,
  chooseBay: (label, free) => `${label}, ${free ? 'free, choose it' : 'not free'}`,
  chargerDetails: (label) => `${label} details`,
  yourBay: 'Your bay',
  freeForVisit: 'Free for your whole visit',
  chargesAtOnce: (n) => `Charges up to ${n} car${n > 1 ? 's' : ''} at once`,
  bayState: {
    free: 'Free',
    taken: 'Not free for this time',
    occupied: 'Occupied',
    reserved: 'Reserved now',
    closed: 'Closed',
    unknown: 'Status unknown',
    neutral: '',
  },
  chargerState: {
    available: 'Available now',
    busy: 'In use or booked now',
    fault: 'Out of service',
  },
  mapOf: (level) => `Map of ${level}`,
};

const ar: MapStrings = {
  lang: 'ar',
  name: (n) => nameIn(n, 'ar'),
  level: (id) => levelNameIn(id, 'ar'),
  levelShort: (id) => levelNameIn(id, 'ar', true),
  gate: (id) => gateNameIn(id, 'ar', true),
  exitOnly: 'خروج فقط',
  rampDown: (to) => (to === 'b1' ? ['منحدر البدروم ١', 'محطة الشحن'] : ['منحدر البدروم ٢', 'مواقف السكان']),
  rampUp: 'المنحدر إلى الطريق الجنوبي',
  lobby: 'إلى البهو',
  aisle: (label) => nameIn(label.replace(/[←→↓↑]/g, '').trim(), 'ar'),
  compass: 'ش',
  youEnterHere: 'ادخل من هنا',
  fromRamp: 'من الطريق الجنوبي',
  free: (free, total) => `${digitsIn(free, 'ar')}/${digitsIn(total, 'ar')} متاح`,
  basementSummary: (free, total) => `${digitsIn(free, 'ar')} من ${digitsIn(total, 'ar')} متاح الآن`,
  freeForYourTime: (free, total) => `${digitsIn(free, 'ar')} من ${digitsIn(total, 'ar')} متاح لوقتك`,
  notBookable: 'غير متاح للحجز في هذه الزيارة',
  availableSpots: (n) => `${digitsIn(n, 'ar')} ${n === 1 ? 'موقف متاح' : 'مواقف متاحة'}`,
  legend: {
    available: 'متاح',
    occupiedNow: 'مشغول',
    unavailable: 'غير متاح',
    route: 'المسار',
    yourBay: 'موقفك',
    selected: 'المختار',
    walk: 'المشي',
    gate: 'بوابة',
    freeNow: 'متاح الآن',
    occupied: 'مشغول',
    reserved: 'محجوز',
    chargerFree: 'شاحن متاح',
    inUse: 'قيد الاستخدام',
    fault: 'عطل',
  },
  walkingRoute: 'مسار المشي',
  bayNumbers: 'أرقام المواقف',
  dragHint: 'اسحب للتنقل',
  zoomIn: 'تكبير',
  zoomOut: 'تصغير',
  fit: 'عرض الدور كاملًا',
  close: 'إغلاق التفاصيل',
  goTo: (level) => `الانتقال إلى ${level}`,
  bayDetails: (label) => `تفاصيل ${label}`,
  chooseBay: (label, free) => `${label}، ${free ? 'متاح، اختره' : 'غير متاح'}`,
  chargerDetails: (label) => `تفاصيل ${label}`,
  yourBay: 'موقفك',
  freeForVisit: 'متاح طوال زيارتك',
  chargesAtOnce: (n) => `يشحن حتى ${digitsIn(n, 'ar')} ${n > 1 ? 'سيارات' : 'سيارة'} في الوقت نفسه`,
  bayState: {
    free: 'متاح',
    taken: 'غير متاح في هذا الوقت',
    occupied: 'مشغول',
    reserved: 'محجوز الآن',
    closed: 'مغلق',
    unknown: 'الحالة غير معروفة',
    neutral: '',
  },
  chargerState: {
    available: 'متاح الآن',
    busy: 'قيد الاستخدام أو محجوز الآن',
    fault: 'خارج الخدمة',
  },
  mapOf: (level) => `خريطة ${level}`,
};

export const mapStrings = (lang: Lang): MapStrings => (lang === 'ar' ? ar : en);
