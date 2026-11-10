import type { Lang } from '../types/i18n.types';

/**
 * Language helpers shared by the parking demo and Health Passport. Kept here, apart from either
 * feature, so Health Passport does not pull the parking demo (and its sample data) into a build.
 */

/** The phone's language, as far as the app speaks it. */
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
