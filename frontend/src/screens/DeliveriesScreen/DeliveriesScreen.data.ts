import type { StatusTone } from '../../components/ui/StatusChip';
import type { ParcelStatus } from '../../../../shared/contracts/parcels';

/** Copy for Deliveries (no Figma reference; set like the inner screens' panels). */
export const deliveriesCopy = {
  title: 'Deliveries',
  subtitle: 'Parcels the gate is holding for you.',
  waitingHeading: 'Waiting for you',
  historyHeading: 'Collected',
  noWaiting: 'Nothing is waiting. The gate logs parcels as they arrive, and you are told at once.',
  noHistory: 'No parcels in the last 30 days.',
  howToCollect: 'Collect from the gate with the reference shown here.',
  noHomeTitle: 'Not linked to an apartment yet',
  noHomeBody: 'Ask building management to add your account to your apartment.',
  loadFailed: 'Couldn’t load your parcels',
  retry: 'Try again',
} as const;

export const statusLook: Record<ParcelStatus, { label: string; tone: StatusTone }> = {
  waiting: { label: 'Waiting', tone: 'violet' },
  collected: { label: 'Collected', tone: 'teal' },
  returned: { label: 'Returned', tone: 'slate' },
};

/** "Today 14:05", or "05 Oct 2026 14:05", on the phone's clock. */
export function receivedAt(iso: string, nowMs = Date.now()): string {
  const at = new Date(iso);
  const time = at.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return new Date(nowMs).toDateString() === at.toDateString()
    ? `Today ${time}`
    : `${at.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} ${time}`;
}
