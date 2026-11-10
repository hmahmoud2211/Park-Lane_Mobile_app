/* The few formatting helpers the parking rules use, copied from frontend/src/utils/format.ts. */

export const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

export function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** "02:30 PM". */
export function formatClock12(hours24: number, minutes: number): string {
  return `${pad2(hours24 % 12 || 12)}:${pad2(minutes)} ${hours24 < 12 ? 'AM' : 'PM'}`;
}
