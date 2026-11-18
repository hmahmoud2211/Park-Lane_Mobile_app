import * as Location from 'expo-location';

import { brand } from '../../../config/brand';
import { backgroundSecureStorage } from '../../../lib/storage/secureStorage';
import { LOCATION_TASK } from './locationReport';

/**
 * How often the phone sends its position. Normally about every 100 m and at most once a minute, which costs little
 * battery. While someone in a Circle has the map open (live view), every ~3 seconds, so they watch the dot move; the
 * backend says until when (`liveUntil`), and when that passes, or nobody renews it, the phone goes back to normal.
 *
 * Switching re-registers the running task with new options rather than stopping it: on Android a stopped location
 * service may not be started again from the background.
 */

export type UpdateMode = 'normal' | 'live';

const MODE_KEY = 'familyCircle.updateMode';
/** Without word from the backend (no signal), a live phone goes back to normal this long after the last liveUntil. */
const LIVE_GRACE_MS = 30_000;

const NORMAL_OPTIONS: Location.LocationTaskOptions = {
  accuracy: Location.Accuracy.Balanced,
  distanceInterval: 100,
  timeInterval: 60_000,
  deferredUpdatesDistance: 100,
  deferredUpdatesInterval: 60_000,
  pausesUpdatesAutomatically: false,
  activityType: Location.ActivityType.Other,
  showsBackgroundLocationIndicator: false,
  foregroundService: {
    notificationTitle: 'Sharing your location',
    notificationBody: `${brand.appName} is sharing your location with your Family Circle.`,
    killServiceOnDestroy: false,
  },
};

const LIVE_OPTIONS: Location.LocationTaskOptions = {
  accuracy: Location.Accuracy.High,
  distanceInterval: 0,
  timeInterval: 3_000,
  deferredUpdatesDistance: 0,
  deferredUpdatesInterval: 0,
  pausesUpdatesAutomatically: false,
  activityType: Location.ActivityType.Other,
  // iPhone shows the blue location pill while live, so the person can see it is happening.
  showsBackgroundLocationIndicator: true,
  foregroundService: {
    notificationTitle: 'Sharing your location live',
    notificationBody: 'Someone in your Family Circle is watching your location live right now.',
    killServiceOnDestroy: false,
  },
};

interface StoredMode {
  mode: UpdateMode;
  /** For live: until when the backend last asked for it (ms). */
  until: number | null;
}

async function readMode(): Promise<StoredMode> {
  try {
    const raw = await backgroundSecureStorage.getItem(MODE_KEY);
    const parsed = raw ? (JSON.parse(raw) as StoredMode) : null;
    return parsed?.mode === 'live' ? { mode: 'live', until: typeof parsed.until === 'number' ? parsed.until : null } : { mode: 'normal', until: null };
  } catch {
    return { mode: 'normal', until: null };
  }
}

const saveMode = (stored: StoredMode) => backgroundSecureStorage.setItem(MODE_KEY, JSON.stringify(stored));

/** Starts the updates (or changes a running task's options) in this mode. */
export async function startUpdates(mode: UpdateMode, until: number | null = null): Promise<void> {
  await Location.startLocationUpdatesAsync(LOCATION_TASK, mode === 'live' ? LIVE_OPTIONS : NORMAL_OPTIONS);
  await saveMode({ mode, until });
}

export const forgetMode = () => backgroundSecureStorage.deleteItem(MODE_KEY).catch(() => undefined);

/**
 * Puts the running updates in the mode the backend asked for: live until `liveUntil`, normal when it is null or past.
 * `undefined` means no word from the backend (no signal): stay as it is, but leave live once it has run out.
 * Does nothing while sharing is off.
 */
export async function followLive(liveUntil: number | null | undefined, now: number = Date.now()): Promise<void> {
  try {
    if (!(await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK))) return;
    const current = await readMode();
    const until = liveUntil === undefined ? current.until : liveUntil;
    const graceMs = liveUntil === undefined ? LIVE_GRACE_MS : 0;
    const wanted: UpdateMode = until !== null && until + graceMs > now ? 'live' : 'normal';
    if (wanted !== current.mode) {
      await startUpdates(wanted, wanted === 'live' ? until : null);
    } else if (wanted === 'live' && until !== current.until) {
      await saveMode({ mode: 'live', until });
    }
  } catch {
    // The next update tries again.
  }
}
