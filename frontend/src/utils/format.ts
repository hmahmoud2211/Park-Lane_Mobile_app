/**
 * Formatting shared by several screens. Built by hand rather than with Intl, so a date
 * reads the same on every device locale.
 */

/** Three-letter English month names, January first. */
export const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** Two digits: 5 -> "05". */
export function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** "02:30 PM": a 24-hour clock time on a 12-hour clock, both parts two digits. */
export function formatClock12(hours24: number, minutes: number): string {
  return `${pad2(hours24 % 12 || 12)}:${pad2(minutes)} ${hours24 < 12 ? 'AM' : 'PM'}`;
}

/** "05 Oct 2026" */
export function formatDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  return `${day} ${SHORT_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** "1 Guest", "3 Guests" */
export function guestsLabel(count: number): string {
  return count === 1 ? '1 Guest' : `${count} Guests`;
}
