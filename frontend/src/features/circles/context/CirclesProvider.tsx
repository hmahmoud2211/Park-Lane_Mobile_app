import { useEffect, type PropsWithChildren } from 'react';

import { useEms } from '../../ems/hooks/useEms';
import { goLive, stopSharingUpdates } from '../services/locationSharing';

/**
 * Family Circle's app-wide part, whatever screen is open:
 * - someone opened a map with this person on it (`location.live`): switch to live updates now, rather than at the
 *   next report (the background task takes it from there and switches back when nobody watches);
 * - signing out stops the location updates and forgets their token at once. (The backend ends the token with the
 *   session anyway, and the background task stops itself when refused; this just doesn't wait for the next update.)
 */
export function CirclesProvider({ children }: PropsWithChildren) {
  const { status, onRealtimeEvent } = useEms();

  useEffect(() => {
    if (status === 'signedOut') void stopSharingUpdates().catch(() => undefined);
  }, [status]);

  useEffect(
    () =>
      onRealtimeEvent((event) => {
        if (event.type === 'location.live') void goLive(event.until);
      }),
    [onRealtimeEvent],
  );

  return children;
}
