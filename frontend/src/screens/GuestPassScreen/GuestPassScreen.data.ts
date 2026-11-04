import { arabicDigits, type Lang } from '../../services/parking/i18n';
import type { DisplayStatusKey } from '../../services/parking/selectors';
import type { ChargingState } from '../../services/parking/types';
import type { SavePassOutcome } from '../../utils/passImage';

/**
 * Everything the visitor's pass says, in English and Arabic. The guest picks
 * the language on the pass; the host's message link can preselect it.
 */
export interface PassCopy {
  title: string;
  city: string;
  welcome: (name?: string) => string;
  status: Record<DisplayStatusKey, string>;
  notFoundTitle: string;
  notFoundBody: string;
  bayMayChangeTitle: string;
  bayMayChangeBody: string;
  addPlateTitle: string;
  addPlateBody: string;
  plateLabel: string;
  platePlaceholder: string;
  saveVehicle: string;
  vehicleSaved: string;
  yourPass: string;
  qrLabel: string;
  qrCaption: Partial<Record<DisplayStatusKey, string>>;
  closedMessage: Partial<Record<DisplayStatusKey, string>>;
  notActive: string;
  saveQr: string;
  saveQrNote: string;
  saved: Record<SavePassOutcome, string>;
  imageTitle: string;
  reference: string;
  vehicle: string;
  notAdded: string;
  yourSpace: string;
  building: string;
  entrance: string;
  directions: string;
  indoorNote: string;
  navigateToGate: string;
  openMap: string;
  fictionalGates: string;
  /** Under "Directions": the map shows the way. */
  mapHint: string;
  /** Demo only: a pass rebuilt from its link (services/parking/passLink). */
  linkNote: string;
  linkEnded: string;
  linkNoPlate: string;
  charging: string;
  chargingState: Record<ChargingState, string>;
  chargingSlot: string;
  delivered: (kwh: number, target?: number) => string;
  demoValues: string;
  enterDoesntCharge: string;
  plugIn: string;
  plugInDone: string;
  stop: string;
  stopDone: string;
  moveOut: (bay: string, time: string) => string;
  help: string;
  contactSecurity: string;
  spaceOccupied: string;
  securityDesk: string;
  call: string;
  askCall: string;
  helpSent: string;
  footer: (reference: string, updated: string) => string;
  /** The language toggle names the other language, in that language. */
  switchLabel: string;
  switchA11y: string;
  failed: string;
  /** Visitor errors by code; English uses the service's own message. */
  errors: Partial<Record<string, string>>;
  chargingCompleteTitle: string;
  chargingCompleteBody: (bay: string, time: string) => string;
  chargerFaultTitle: string;
  chargerFaultBody: string;
}

const en: PassCopy = {
  title: 'Guest Pass',
  city: 'New Capital (demo)',
  welcome: (name) => `Welcome, ${name ?? 'guest'}`,
  status: {
    confirmed: 'Confirmed',
    'action-needed': 'Action needed',
    'checked-in': 'Checked in',
    overdue: 'Overdue',
    completed: 'Completed',
    cancelled: 'Cancelled',
    'no-show': 'Expired',
  },
  notFoundTitle: 'This pass isn’t available here',
  notFoundBody:
    'This demo keeps bookings on the device where they were made. Open the link in the same browser the resident used. Sharing passes between phones needs a shared server, which this demo does not include.',
  bayMayChangeTitle: 'Your bay may change',
  bayMayChangeBody: 'Security will direct you to another bay when you arrive. This page updates if your host moves the booking.',
  addPlateTitle: 'Add your vehicle',
  addPlateBody: 'The gate needs your plate number before you can enter.',
  plateLabel: 'Plate number',
  platePlaceholder: 'e.g. EGY 1234',
  saveVehicle: 'Save vehicle',
  vehicleSaved: 'Vehicle saved. You’re ready to enter.',
  yourPass: 'Your pass',
  qrLabel: 'Gate pass QR code',
  qrCaption: {
    confirmed: 'Show this code at the entrance gate. Keep it: the same code lets you out.',
    'action-needed': 'Show this code at the entrance gate. Security will direct you to your bay.',
    'checked-in': 'You’re checked in. Show this code at the exit gate when you leave.',
    overdue: 'Your booked time has ended. Show this code at the exit gate to leave.',
  },
  closedMessage: {
    completed: 'Thanks for visiting. This pass has been used and can’t be used to enter again.',
    cancelled: 'Your host cancelled this booking, so the pass no longer works.',
    'no-show': 'This booking expired because the arrival time passed. Ask your host for a new one.',
  },
  notActive: 'This pass is not active.',
  saveQr: 'Save QR',
  saveQrNote: 'Works offline at the gate, until your host issues a new code.',
  saved: {
    downloaded: 'Pass image saved to your downloads.',
    shared: 'Pass image ready. Choose Save Image to keep it in your photos.',
    dismissed: 'Nothing was saved.',
    failed: 'Couldn’t make the pass image on this device. Take a screenshot of the code instead.',
  },
  imageTitle: 'Guest parking pass',
  reference: 'Reference',
  vehicle: 'Vehicle',
  notAdded: 'Not added yet',
  yourSpace: 'Your space',
  building: 'Building',
  entrance: 'Entrance',
  directions: 'Directions',
  indoorNote: 'Phone GPS can’t locate basement bays. Follow the level signs and the route on the map.',
  navigateToGate: 'Navigate to gate',
  openMap: 'Open the map',
  fictionalGates: 'Gate locations in this demo are fictional.',
  mapHint: 'The map lights up your route from the gate to your space.',
  linkNote: 'Demo pass opened from your host’s link: if they change the booking, ask them for a new link.',
  linkEnded: 'This visit’s time has ended.',
  linkNoPlate: 'Send your plate number to your host',
  charging: 'Charging',
  chargingState: {
    reserved: 'Charging booked',
    'waiting-for-plug-in': 'Ready to plug in',
    charging: 'Charging',
    completed: 'Charging finished',
    interrupted: 'Charging stopped',
    faulted: 'Charger fault',
  },
  chargingSlot: 'Your charging slot',
  delivered: (kwh, target) => `${kwh} kWh delivered${target ? ` of ${target} kWh` : ''}.`,
  demoValues: 'Charging figures are simulated demo values.',
  enterDoesntCharge: 'Entering the compound doesn’t start charging. Plug in at your bay, then start it here.',
  plugIn: 'Plug in & start charging',
  plugInDone: 'Charging started.',
  stop: 'Stop charging & unplug',
  stopDone: 'Charging stopped. Please move your car out of the EV bay.',
  moveOut: (bay, time) => `Please move your car out of ${bay} by ${time} so the next driver can charge.`,
  help: 'Need help?',
  contactSecurity: 'Contact security',
  spaceOccupied: 'Space occupied',
  securityDesk: 'Security desk (demo number)',
  call: 'Call',
  askCall: 'Ask security to call me',
  helpSent: 'Security has been told and will contact you. (Simulated in this demo.)',
  footer: (reference, updated) => `Pass ${reference} · updated ${updated}`,
  switchLabel: 'عربي',
  switchA11y: 'اعرض التصريح بالعربية',
  failed: 'That did not work. Please try again.',
  errors: {},
  chargingCompleteTitle: 'Charging complete',
  chargingCompleteBody: (bay, time) => `Please move the vehicle out of ${bay} by ${time}.`,
  chargerFaultTitle: 'Charging interrupted',
  chargerFaultBody: 'The charger reported a fault. The vehicle can stay in its bay until security helps.',
};

const ar: PassCopy = {
  title: 'تصريح الزائر',
  city: 'العاصمة الإدارية الجديدة (تجريبي)',
  welcome: (name) => (name ? `أهلًا ${name}` : 'أهلًا بك'),
  status: {
    confirmed: 'مؤكد',
    'action-needed': 'يحتاج إجراء',
    'checked-in': 'تم الدخول',
    overdue: 'تجاوز الوقت',
    completed: 'انتهت الزيارة',
    cancelled: 'ملغي',
    'no-show': 'منتهي',
  },
  notFoundTitle: 'هذا التصريح غير متاح هنا',
  notFoundBody:
    'هذا العرض التجريبي يحفظ الحجوزات على الجهاز الذي أُنشئت عليه. افتح الرابط في المتصفح نفسه الذي استخدمه المقيم. مشاركة التصاريح بين الهواتف تحتاج إلى خادم مشترك، وهو غير موجود في هذا العرض.',
  bayMayChangeTitle: 'قد يتغير موقفك',
  bayMayChangeBody: 'سيوجهك الأمن إلى موقف آخر عند وصولك. تتحدث هذه الصفحة إذا نقل مضيفك الحجز.',
  addPlateTitle: 'أضف مركبتك',
  addPlateBody: 'تحتاج البوابة إلى رقم لوحة سيارتك قبل الدخول.',
  plateLabel: 'رقم اللوحة',
  platePlaceholder: 'مثال: EGY 1234',
  saveVehicle: 'حفظ المركبة',
  vehicleSaved: 'تم حفظ المركبة. أنت جاهز للدخول.',
  yourPass: 'تصريحك',
  qrLabel: 'رمز QR لتصريح البوابة',
  qrCaption: {
    confirmed: 'اعرض هذا الرمز عند بوابة الدخول، واحتفظ به: الرمز نفسه يسمح لك بالخروج.',
    'action-needed': 'اعرض هذا الرمز عند بوابة الدخول. سيوجهك الأمن إلى موقفك.',
    'checked-in': 'تم تسجيل دخولك. اعرض هذا الرمز عند بوابة الخروج عند المغادرة.',
    overdue: 'انتهى وقتك المحجوز. اعرض هذا الرمز عند بوابة الخروج للمغادرة.',
  },
  closedMessage: {
    completed: 'شكرًا لزيارتك. تم استخدام هذا التصريح ولا يمكن الدخول به مرة أخرى.',
    cancelled: 'ألغى مضيفك هذا الحجز، لذلك لم يعد التصريح صالحًا.',
    'no-show': 'انتهى هذا الحجز لأن موعد الوصول قد مرّ. اطلب من مضيفك حجزًا جديدًا.',
  },
  notActive: 'هذا التصريح غير مفعّل.',
  saveQr: 'حفظ رمز QR',
  saveQrNote: 'يعمل عند البوابة دون إنترنت، حتى يصدر مضيفك رمزًا جديدًا.',
  saved: {
    downloaded: 'تم حفظ صورة التصريح في التنزيلات.',
    shared: 'صورة التصريح جاهزة. اختر «حفظ الصورة» لحفظها في الصور.',
    dismissed: 'لم يتم حفظ شيء.',
    failed: 'تعذّر إنشاء صورة التصريح على هذا الجهاز. التقط لقطة شاشة للرمز بدلًا من ذلك.',
  },
  imageTitle: 'تصريح موقف زائر',
  reference: 'رقم التصريح',
  vehicle: 'المركبة',
  notAdded: 'لم تُضف بعد',
  yourSpace: 'موقفك',
  building: 'المبنى',
  entrance: 'المدخل',
  directions: 'الاتجاهات',
  indoorNote: 'لا يستطيع GPS الهاتف تحديد المواقف في البدروم. اتبع لافتات الأدوار والمسار على الخريطة.',
  navigateToGate: 'الطريق إلى البوابة',
  openMap: 'افتح الخريطة',
  fictionalGates: 'مواقع البوابات في هذا العرض التجريبي غير حقيقية.',
  mapHint: 'تضيء الخريطة طريقك من البوابة إلى موقفك.',
  linkNote: 'تصريح تجريبي فُتح من رابط مضيفك: إذا غيّر الحجز، اطلب منه رابطًا جديدًا.',
  linkEnded: 'انتهى وقت هذه الزيارة.',
  linkNoPlate: 'أرسل رقم لوحتك إلى مضيفك',
  charging: 'الشحن',
  chargingState: {
    reserved: 'الشحن محجوز',
    'waiting-for-plug-in': 'جاهز لتوصيل الشاحن',
    charging: 'جارٍ الشحن',
    completed: 'اكتمل الشحن',
    interrupted: 'توقف الشحن',
    faulted: 'عطل في الشاحن',
  },
  chargingSlot: 'موعد الشحن',
  delivered: (kwh, target) =>
    arabicDigits(`تم شحن ${kwh} كيلوواط ساعة${target ? ` من ${target} كيلوواط ساعة` : ''}.`),
  demoValues: 'أرقام الشحن قيم تجريبية.',
  enterDoesntCharge: 'الدخول إلى الكمبوند لا يبدأ الشحن. وصّل الشاحن في موقفك، ثم ابدأ الشحن من هنا.',
  plugIn: 'وصّل الشاحن وابدأ الشحن',
  plugInDone: 'بدأ الشحن.',
  stop: 'أوقف الشحن وافصل الشاحن',
  stopDone: 'توقف الشحن. يُرجى نقل سيارتك من موقف الشحن.',
  moveOut: (bay, time) => `يُرجى نقل سيارتك من ${bay} قبل ${time} ليتمكن السائق التالي من الشحن.`,
  help: 'تحتاج مساعدة؟',
  contactSecurity: 'تواصل مع الأمن',
  spaceOccupied: 'الموقف مشغول',
  securityDesk: 'مكتب الأمن (رقم تجريبي)',
  call: 'اتصال',
  askCall: 'اطلب أن يتصل بك الأمن',
  helpSent: 'تم إبلاغ الأمن وسيتواصلون معك. (محاكاة في هذا العرض.)',
  footer: (reference, updated) => `التصريح ${reference} · آخر تحديث ${updated}`,
  switchLabel: 'EN',
  switchA11y: 'Show the pass in English',
  failed: 'لم ينجح ذلك. حاول مرة أخرى.',
  errors: {
    'invalid-plate': 'اكتب رقم اللوحة بالحروف والأرقام، مثل EGY 1234.',
    'not-editable': 'يمكن تغيير بيانات المركبة قبل الوصول فقط.',
    'not-in-bay': 'يجب أن تكون السيارة قد دخلت وتقف في موقف الشحن لبدء الشحن.',
    'session-state': 'تم استخدام موعد الشحن هذا بالفعل.',
    'slot-released': 'تم إلغاء موعد الشحن لهذا الحجز.',
    'charger-down': 'الشاحن غير متاح الآن. تم إبلاغ الأمن.',
    'slot-not-started': 'لم يبدأ موعد الشحن بعد.',
    'slot-ended': 'انتهى وقت الشحن المحجوز.',
    'not-charging': 'الشحن لا يعمل.',
    'invite-not-found': 'هذا التصريح غير متاح.',
  },
  chargingCompleteTitle: 'اكتمل الشحن',
  chargingCompleteBody: (bay, time) => `يُرجى نقل السيارة من ${bay} قبل ${time}.`,
  chargerFaultTitle: 'توقف الشحن',
  chargerFaultBody: 'أبلغ الشاحن عن عطل. يمكن أن تبقى السيارة في موقفها حتى يساعدك الأمن.',
};

export const passCopy: Record<Lang, PassCopy> = { en, ar };

/**
 * "Charger A · AC 22 kW" in the reader's language. In Arabic a right-to-left
 * mark after the letter keeps "A" and "AC" from running together as one
 * left-to-right phrase.
 */
export function chargerNameIn(label: string | undefined, lang: Lang): string {
  if (!label) return '';
  if (lang === 'en') return label;
  return arabicDigits(label.replace(/^Charger (\S+)/, 'الشاحن $1\u200F').replace(/ kW\b/, ' كيلوواط'));
}
