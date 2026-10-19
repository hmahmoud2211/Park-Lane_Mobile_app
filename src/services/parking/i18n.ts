/**
 * English and Arabic wording for what a guest sees: the pass, its route and
 * its map. Resident and security screens stay in English.
 *
 * Arabic text uses Arabic-Indic digits for dates, times and counts, and keeps
 * codes exactly as they are signed on site: bay V-014, plate EGY 1234,
 * building A. Names come from site.ts in English and are translated here by
 * name, so a real site adds its own names to these tables.
 */
import { gateDefs, levels } from './site';
import { cairoParts, formatDate, formatDuration, formatRange, formatTime } from './time';
import type { LevelId, RouteStep, RouteStepInfo, RouteStepKind, WalkTarget } from './types';

export type Lang = 'en' | 'ar';

export const isLang = (value: unknown): value is Lang => value === 'en' || value === 'ar';

/** Arabic when the phone or browser is set to Arabic, else English. */
export function deviceLang(): Lang {
  try {
    return Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith('ar') ? 'ar' : 'en';
  } catch {
    return 'en';
  }
}

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

/** Arabic-Indic digits, with the Arabic decimal separator: 33.3 becomes ٣٣٫٣. */
export const arabicDigits = (text: string) =>
  text.replace(/(\d)\.(\d)/g, '$1٫$2').replace(/[0-9]/g, (d) => AR_DIGITS[Number(d)]);

/** Numbers in the reader's digits. */
export const digitsIn = (text: string | number, lang: Lang) => (lang === 'ar' ? arabicDigits(String(text)) : String(text));

/* -------------------------------------------------------- Dates, times */

const AR_WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];

const toMs = (value: string | number) => (typeof value === 'number' ? value : Date.parse(value));

/** "02:30 PM", or "٢:٣٠ م". */
export function timeIn(value: string | number, lang: Lang): string {
  if (lang === 'en') return formatTime(value);
  const p = cairoParts(toMs(value));
  const hour12 = p.hour % 12 === 0 ? 12 : p.hour % 12;
  return arabicDigits(`${hour12}:${String(p.minute).padStart(2, '0')}`) + (p.hour < 12 ? ' ص' : ' م');
}

/** "Tue 13 Oct 2026", or "الثلاثاء ١٣ أكتوبر ٢٠٢٦". */
export function dateIn(value: string | number, lang: Lang, withYear = true): string {
  if (lang === 'en') return formatDate(value, withYear);
  const p = cairoParts(toMs(value));
  return arabicDigits(`${AR_WEEKDAYS[p.weekday]} ${p.day} ${AR_MONTHS[p.month - 1]}${withYear ? ` ${p.year}` : ''}`);
}

/** A visit's time span, naming the end's date only when it differs. */
export function rangeIn(start: string | number, end: string | number, lang: Lang): string {
  if (lang === 'en') return formatRange(start, end);
  const sameDay = dateIn(start, 'ar', false) === dateIn(end, 'ar', false);
  return sameDay
    ? `${dateIn(start, 'ar', false)}، ${timeIn(start, 'ar')} – ${timeIn(end, 'ar')}`
    : `${dateIn(start, 'ar', false)}، ${timeIn(start, 'ar')} – ${dateIn(end, 'ar', false)}، ${timeIn(end, 'ar')}`;
}

/** "2h 15m", or "٢ س ١٥ د". */
export function durationIn(minutes: number, lang: Lang): string {
  if (lang === 'en') return formatDuration(minutes);
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return arabicDigits([h ? `${h} س` : '', m || !h ? `${m} د` : ''].filter(Boolean).join(' '));
}

/* --------------------------------------------------------------- Names */

const AR_NAMES: Readonly<Record<string, string>> = {
  'Main Avenue': 'الشارع الرئيسي',
  'Central Avenue': 'الشارع الأوسط',
  'South Road': 'الطريق الجنوبي',
  'Aisle 1': 'الممر ١',
  'Aisle 2': 'الممر ٢',
  'Aisle 3': 'الممر ٣',
  'Building A': 'مبنى A',
  'Building B': 'مبنى B',
  'Building C': 'مبنى C',
  'Visitor Court North': 'ساحة الزوار الشمالية',
  'Visitor Lane East': 'ممر الزوار الشرقي',
  'EV Hub': 'محطة الشحن',
  Residents: 'مواقف السكان',
  Garden: 'حديقة',
  Clubhouse: 'النادي',
  Pool: 'حمام السباحة',
  'General parking': 'مواقف عامة',
  'Residents’ bays': 'مواقف السكان',
  'Lift A': 'مصعد A',
  'Lift C': 'مصعد C',
  Ground: 'الدور الأرضي',
  'Basement 1': 'البدروم الأول',
  'Basement 2': 'البدروم الثاني',
};

/** A site name (road, building, zone, landmark) in the reader's language. */
export const nameIn = (name: string, lang: Lang) => (lang === 'ar' ? (AR_NAMES[name] ?? name) : name);

const AR_GATES: Readonly<Record<string, { name: string; short: string; description: string }>> = {
  'gate-1': { name: 'البوابة ١ · البوابة الرئيسية', short: 'البوابة ١', description: 'المدخل الغربي من الطريق الرئيسي' },
  'gate-2': { name: 'البوابة ٢ · البوابة الشرقية', short: 'البوابة ٢', description: 'المدخل الشرقي بجوار النادي' },
  'gate-3': { name: 'البوابة ٣ · بوابة الخدمة', short: 'البوابة ٣', description: 'مخرج جنوبي فقط' },
};

export function gateNameIn(gateId: string, lang: Lang, short = false): string {
  const gate = gateDefs.find((g) => g.id === gateId);
  if (lang === 'ar' && AR_GATES[gateId]) return short ? AR_GATES[gateId].short : AR_GATES[gateId].name;
  if (!gate) return gateId;
  return short ? gate.name.split(' · ')[0] : gate.name;
}

export function gateDescriptionIn(gateId: string, lang: Lang): string {
  if (lang === 'ar' && AR_GATES[gateId]) return AR_GATES[gateId].description;
  return gateDefs.find((g) => g.id === gateId)?.description ?? '';
}

const AR_LEVELS: Readonly<Record<LevelId, { name: string; short: string }>> = {
  ground: { name: 'الدور الأرضي', short: 'الأرضي' },
  b1: { name: 'البدروم الأول · محطة الشحن', short: 'البدروم ١ · الشحن' },
  b2: { name: 'البدروم الثاني · السكان', short: 'البدروم ٢ · السكان' },
};

export function levelNameIn(id: LevelId, lang: Lang, short = false): string {
  if (lang === 'ar') return short ? AR_LEVELS[id].short : AR_LEVELS[id].name;
  const level = levels.find((l) => l.id === id);
  return (short ? level?.short : level?.name) ?? id;
}

/* --------------------------------------------------------- Route steps */

const EN_ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];
const AR_ORDINALS = ['الأول', 'الثاني', 'الثالث', 'الرابع', 'الخامس', 'السادس', 'السابع', 'الثامن'];
const AR_HEADINGS = { north: 'شمالًا', south: 'جنوبًا', east: 'شرقًا', west: 'غربًا' } as const;

function walkText(target: WalkTarget, lang: Lang): string {
  if (lang === 'ar') {
    return target.kind === 'entrance'
      ? `امشِ إلى مدخل مبنى ${target.building}`
      : `امشِ إلى المصعد ${target.lift}، ثم اصعد إلى بهو مبنى ${target.building}`;
  }
  return target.kind === 'entrance'
    ? `Walk to the Building ${target.building} entrance`
    : `Walk to Lift ${target.lift}, up to the Building ${target.building} lobby`;
}

/**
 * The wording of a route step. English and Arabic are written from the same
 * facts, so the two can never drift apart.
 */
export function describeStep(kind: RouteStepKind, info: RouteStepInfo, lang: Lang): string {
  const road = nameIn(info.road ?? '', lang);
  if (lang === 'ar') {
    const turn = info.turn === 'left' ? 'يسارًا' : 'يمينًا';
    const lead = info.afterRamp ? 'في أسفل المنحدر، ' : '';
    switch (kind) {
      case 'enter':
        return `ادخل من ${gateNameIn(info.gateId ?? '', 'ar')}`;
      case 'head':
        return `اتجه ${AR_HEADINGS[info.heading ?? 'north']} على ${road}`;
      case 'continue':
        return `${lead}تابع إلى ${road}`;
      case 'turn-left':
      case 'turn-right':
        return `${lead}انعطف ${turn} إلى ${road}`;
      case 'ramp':
        return `انزل المنحدر إلى ${levelNameIn(info.toLevel ?? 'b1', 'ar')}`;
      case 'park':
        return `اركن في ${info.bay}، الموقف ${AR_ORDINALS[(info.ordinal ?? 1) - 1] ?? arabicDigits(String(info.ordinal))} على ${info.side === 'left' ? 'يسارك' : 'يمينك'}`;
      case 'walk':
        return info.walkTo ? walkText(info.walkTo, 'ar') : '';
    }
  }
  const lead = info.afterRamp ? 'At the foot of the ramp, ' : '';
  switch (kind) {
    case 'enter':
      return `Enter at ${gateNameIn(info.gateId ?? '', 'en')}`;
    case 'head':
      return `Head ${info.heading} on ${road}`;
    case 'continue':
      return info.afterRamp ? `${lead}continue onto ${road}` : `Continue onto ${road}`;
    case 'turn-left':
    case 'turn-right':
      return info.afterRamp ? `${lead}turn ${info.turn} onto ${road}` : `Turn ${info.turn} onto ${road}`;
    case 'ramp':
      return `Take the ramp down to ${levelNameIn(info.toLevel ?? 'b1', 'en')}`;
    case 'park':
      return `Park in ${info.bay}, the ${EN_ORDINALS[(info.ordinal ?? 1) - 1] ?? `${info.ordinal}th`} bay on your ${info.side}`;
    case 'walk':
      return info.walkTo ? walkText(info.walkTo, 'en') : '';
  }
}

/** A stored step's wording in the reader's language. */
export const stepText = (step: RouteStep, lang: Lang) => (lang === 'en' ? step.text : describeStep(step.kind, step.info, lang));
