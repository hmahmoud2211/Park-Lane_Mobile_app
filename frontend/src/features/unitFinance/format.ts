import { formatDate } from '../../utils/format';

/**
 * Money as residents read it: piastres from the API → "EGP 8,500,000" (or "EGP 310.50"). `whole` rounds to the
 * pound, for the compact figures on cards; lists of bills keep the exact amount.
 */
export function egp(piastres: number, { whole = false }: { whole?: boolean } = {}): string {
  const pounds = whole ? Math.round(piastres / 100) : piastres / 100;
  const text = Number.isInteger(pounds)
    ? String(pounds).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    : pounds.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))(?=.*\.)/g, ',');
  return `EGP ${text}`;
}

/** A compound date from the API (YYYY-MM-DD) → "05 Oct 2026", without any time-zone shift. */
export function day(isoDay: string): string {
  const [year, month, date] = isoDay.split('-').map(Number);
  return formatDate(new Date(year, month - 1, date));
}

/** "2026-10" → "Oct 2026". */
export function month(period: string): string {
  return day(`${period}-01`).slice(3);
}
