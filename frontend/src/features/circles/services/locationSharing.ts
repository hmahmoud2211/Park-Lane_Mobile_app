import * as Location from 'expo-location';
import { Linking } from 'react-native';

import type { LocationAccess } from '../types';
import { createLocationToken } from './circlesApi';
import { LOCATION_TASK, forgetLocationToken, reportWithToken, saveLocationToken } from './locationReport';
import { followLive, forgetMode, startUpdates } from './updateMode';

/**
 * Starting and stopping the phone's location updates for Family Circle (docs/plans/FAMILY_CIRCLE_PLAN.md). The
 * updates run in the background task (backgroundTask.ts): normally about every 100 m and at most once a minute,
 * which keeps the battery cost low, and every few seconds while someone watches live (updateMode.ts). Android shows a
 * notification while they run; the system requires it. The web app has its own version of this file: a browser
 * cannot share in the background.
 */

/** Live view reached the open app over the realtime channel: switch now rather than at the next report. */
export const goLive = (until: number) => followLive(until);

/** What the phone allows now, without asking. */
export async function locationAccess(): Promise<LocationAccess> {
  const foreground = await Location.getForegroundPermissionsAsync();
  if (!foreground.granted) {
    return foreground.canAskAgain ? 'undetermined' : 'denied';
  }
  const background = await Location.getBackgroundPermissionsAsync();
  return background.granted ? 'always' : 'whileUsing';
}

/**
 * Asks the phone, in the order the stores require: "While using the app" first, then "Always" (on Android 11 and
 * later that opens the phone's settings). Call it only after the app has explained why (the disclosure).
 */
export async function askForLocation(): Promise<LocationAccess> {
  const foreground = await Location.requestForegroundPermissionsAsync();
  if (!foreground.granted) {
    return foreground.canAskAgain ? 'undetermined' : 'denied';
  }
  try {
    await Location.requestBackgroundPermissionsAsync();
  } catch {
    // Some phones refuse to ask from here; sharing still works while the app is open.
  }
  return locationAccess();
}

export const openLocationSettings = () => Linking.openSettings();

export async function sharingUpdatesRunning(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  } catch {
    return false;
  }
}

/** Gets a fresh location token, starts the updates if they are not running, and sends the position now. */
export async function startSharingUpdates(): Promise<void> {
  const { token } = await createLocationToken();
  await saveLocationToken(token);
  if (!(await sharingUpdatesRunning())) {
    await startUpdates('normal');
  }
  try {
    // So the dot appears straight away rather than after the first 100 m, and live view starts if someone watches.
    const now = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    const outcome = await reportWithToken([now]);
    if (outcome.kind === 'sent') await followLive(outcome.liveUntil);
  } catch {
    // No fix yet: the updates send one when the phone has it.
  }
}

/** Stops the updates and forgets the location token. Safe to call when nothing runs. */
export async function stopSharingUpdates(): Promise<void> {
  try {
    if (await sharingUpdatesRunning()) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    }
  } finally {
    await forgetLocationToken();
    await forgetMode();
  }
}
