/* Language helpers the parking rules use, copied from frontend/src/utils/lang.ts and types/i18n.types.ts. */

export type Lang = 'en' | 'ar';

/** The backend writes English by default; the app formats for the reader. */
export function deviceLang(): Lang {
  return 'en';
}

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';

export const arabicDigits = (text: string) => text.replace(/(\d)\.(\d)/g, '$1٫$2').replace(/[0-9]/g, (d) => AR_DIGITS[Number(d)]);

export const digitsIn = (text: string | number, lang: Lang) => (lang === 'ar' ? arabicDigits(String(text)) : String(text));
