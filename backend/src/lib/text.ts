/** A name or label from a request body: trimmed and cut to `max` characters, or '' when it is not a string. */
export function trimmedText(input: unknown, max = 64): string {
  return typeof input === 'string' ? input.trim().slice(0, max) : '';
}

/** Folds the spellings speech recognition varies between, in Arabic and English. */
export function normalize(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[ً-ْٰـ]/g, '') // harakat, dagger alif, tatweel
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
