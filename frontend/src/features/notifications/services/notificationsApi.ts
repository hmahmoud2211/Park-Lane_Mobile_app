import type { NotificationPage, NotificationPrefs } from '../../../../../shared/contracts/notifications';
import { call } from '../../ems/services/emsHttp';

/** The resident's inbox on the EMS backend (backend/src/routes/notifications.ts). */

export const listNotifications = (before?: string | null) =>
  call<NotificationPage>(`/api/notifications${before ? `?before=${encodeURIComponent(before)}` : ''}`, { retry: true });

export const markNotificationsRead = (ids: readonly string[] | 'all') =>
  call<{ unread: number }>('/api/notifications/read', { method: 'POST', body: ids === 'all' ? { all: true } : { ids } });

export const getNotificationPrefs = () => call<NotificationPrefs>('/api/notifications/prefs', { retry: true });

export const setNotificationPref = (kind: keyof NotificationPrefs, enabled: boolean) =>
  call<NotificationPrefs>('/api/notifications/prefs', { method: 'PUT', body: { [kind]: enabled } });
