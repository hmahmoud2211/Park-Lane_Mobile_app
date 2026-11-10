import type { NotificationKind } from '../../../../shared/contracts/notifications';

/** Copy for Notifications (no Figma reference; set like Settings and its panels). */
export const notificationsCopy = {
  title: 'Notifications',
  subtitle: 'Updates about your apartment and requests.',
  inboxHeading: 'Inbox',
  empty: 'Nothing yet. Updates on your requests, visitors, parcels and bookings appear here.',
  markAllRead: 'Mark all as read',
  loadMore: 'Show older',
  settingsHeading: 'What to tell me about',
  settingsHint: 'Turned off, those updates are not kept or shown.',
  guestTitle: 'You are not signed in',
  guestBody: 'Sign in to see updates about your apartment.',
  signIn: 'Sign in',
  errorTitle: 'Couldn’t load notifications',
  retry: 'Try again',
  unread: 'Unread',
} as const;

export const kindLabels: Record<NotificationKind, string> = {
  requests: 'Maintenance and service requests',
  visitors: 'Visitors',
  parcels: 'Parcels at the gate',
  bookings: 'Amenity bookings',
  community: 'Announcements and events',
  bills: 'Bills and payments',
  parking: 'Parking',
  account: 'Your account',
};

/** "Just now", "5 min ago", "3 h ago", or the date. */
export function timeAgo(iso: string, nowMs = Date.now()): string {
  const minutes = Math.round((nowMs - Date.parse(iso)) / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}
