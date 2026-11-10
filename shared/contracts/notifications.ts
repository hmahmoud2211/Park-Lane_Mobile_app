/** The in-app inbox: GET /api/notifications, POST /api/notifications/read, GET|PUT /api/notifications/prefs. */

/** What a notification is about; residents can turn each kind off (Settings → Notifications). */
export type NotificationKind = 'requests' | 'visitors' | 'parcels' | 'bookings' | 'community' | 'bills' | 'parking' | 'account';

export interface AppNotification {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string | null;
  /** What it points at, so the app can open it, e.g. { type: 'service_request', id }. */
  ref: { type: string; id: string } | null;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationPage {
  items: AppNotification[];
  unread: number;
  /** Pass as `before` for the next page; null at the end. */
  next: string | null;
}

export type NotificationPrefs = Record<NotificationKind, boolean>;

/** Realtime: a new notification for this resident. */
export interface NotificationEvent {
  type: 'notification.new';
  notification: AppNotification;
  unread: number;
}
