import type { Reservation } from '../../services/parking/types';

export type HistoryFilter = 'all' | 'upcoming' | 'active' | 'past';

export const historyCopy = {
  title: 'Reservation History',
  empty: 'No bookings here yet.',
} as const;

export const filterOptions: { value: HistoryFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'active', label: 'Active' },
  { value: 'past', label: 'Past' },
];

export function matchesFilter(r: Reservation, filter: HistoryFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'upcoming':
      return r.status === 'confirmed';
    case 'active':
      return r.status === 'checked-in';
    case 'past':
      return r.status === 'completed' || r.status === 'cancelled' || r.status === 'no-show';
  }
}
