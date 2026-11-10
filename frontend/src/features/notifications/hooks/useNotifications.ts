import { useFocusEffect } from '@react-navigation/native';
import { useCallback, useEffect, useState } from 'react';

import type { AppNotification, NotificationPrefs } from '../../../../../shared/contracts/notifications';
import { useEms } from '../../ems/hooks/useEms';
import { emsErrorText } from '../../ems/services/emsHttp';
import * as api from '../services/notificationsApi';

export type InboxState =
  | { status: 'signedOut' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: AppNotification[]; unread: number; next: string | null };

/**
 * The signed-in resident's inbox: the first page, more on request, new ones as they arrive (realtime), and the
 * settings for each kind. Refetched when the realtime channel reconnects.
 */
export function useNotifications() {
  const { status, onRealtimeEvent } = useEms();
  const [inbox, setInbox] = useState<InboxState>({ status: 'loading' });
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const signedIn = status === 'signedIn';

  // Loaded whenever the screen is shown, so updates made elsewhere appear without pulling to refresh.
  const reload = useCallback(() => {
    if (!signedIn) return;
    Promise.all([api.listNotifications(), api.getNotificationPrefs()])
      .then(([page, settings]) => {
        setInbox({ status: 'ready', items: page.items, unread: page.unread, next: page.next });
        setPrefs(settings);
      })
      .catch((error: unknown) => setInbox({ status: 'error', message: emsErrorText(error) }));
  }, [signedIn]);

  useFocusEffect(reload);

  useEffect(() => {
    if (!signedIn) return undefined;
    return onRealtimeEvent((event) => {
      if (event.type === 'ready') {
        reload();
      } else if (event.type === 'notification.new') {
        setInbox((current) =>
          current.status === 'ready' && !current.items.some((item) => item.id === event.notification.id)
            ? { ...current, items: [event.notification, ...current.items], unread: event.unread }
            : current,
        );
      }
    });
  }, [signedIn, reload, onRealtimeEvent]);

  const loadMore = useCallback(async () => {
    if (inbox.status !== 'ready' || !inbox.next) return;
    const page = await api.listNotifications(inbox.next);
    setInbox((current) => (current.status === 'ready' ? { ...current, items: [...current.items, ...page.items], next: page.next } : current));
  }, [inbox]);

  const markAllRead = useCallback(async () => {
    const { unread } = await api.markNotificationsRead('all');
    const at = new Date().toISOString();
    setInbox((current) =>
      current.status === 'ready' ? { ...current, unread, items: current.items.map((item) => ({ ...item, readAt: item.readAt ?? at })) } : current,
    );
  }, []);

  const setPref = useCallback(async (kind: keyof NotificationPrefs, enabled: boolean) => {
    setPrefs((current) => (current ? { ...current, [kind]: enabled } : current));
    try {
      setPrefs(await api.setNotificationPref(kind, enabled));
    } catch {
      setPrefs((current) => (current ? { ...current, [kind]: !enabled } : current));
    }
  }, []);

  // Signed out is known from the session, so it is worked out here rather than stored.
  return { inbox: signedIn ? inbox : ({ status: 'signedOut' } as const), prefs, reload, loadMore, markAllRead, setPref };
}
