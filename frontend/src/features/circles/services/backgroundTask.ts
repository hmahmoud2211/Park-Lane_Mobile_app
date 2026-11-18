import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { LOCATION_TASK, forgetLocationToken, reportWithToken } from './locationReport';
import { followLive, forgetMode } from './updateMode';

/**
 * Family Circle's background task: the phone wakes it with new positions (locationSharing.ts starts it) and it sends
 * them with the location token. It must be defined when the JavaScript loads, before anything renders, or a phone
 * that wakes the app in the background finds no task: index.ts imports this file first.
 *
 * The backend's answer steers it: `liveUntil` switches to fast updates while someone watches the map, and back
 * afterwards (updateMode.ts); "shares nowhere" or a refused token stops the updates, so a phone never keeps sending
 * for nothing.
 */
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data?.locations) return;
  const outcome = await reportWithToken(data.locations);
  switch (outcome.kind) {
    case 'sent':
      await followLive(outcome.liveUntil);
      return;
    case 'retry':
      // No word from the backend: stay as it is, but don't stay live past the last time it asked for.
      await followLive(undefined);
      return;
    case 'stop':
    case 'signedOut':
      await Location.stopLocationUpdatesAsync(LOCATION_TASK).catch(() => undefined);
      await forgetLocationToken();
      await forgetMode();
  }
});
