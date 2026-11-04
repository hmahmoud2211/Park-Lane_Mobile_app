/**
 * Formatting shared by several screens. Built by hand rather than with Intl, so a date
 * reads the same on every device locale.
 */

/** Three-letter English month names, January first. */
export const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/** "05 Oct 2026" */
export function formatDate(date: Date): string {
  const day = String(date.getDate()).padStart(2, '0');
  return `${day} ${SHORT_MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

/** "1 Guest", "3 Guests" */
export function guestsLabel(count: number): string {
  return count === 1 ? '1 Guest' : `${count} Guests`;
}
