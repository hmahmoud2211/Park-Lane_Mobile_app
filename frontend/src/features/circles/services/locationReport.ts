import * as Battery from 'expo-battery';
import type { LocationObject } from 'expo-location';

import { EmsError } from '../../ems/services/emsHttp';
import { backgroundSecureStorage } from '../../../lib/storage/secureStorage';
import type { BatteryInfo, LocationPoint, LocationReportResult } from '../types';
import { sendLocationReport } from './circlesApi';

/**
 * One location report, as the background task and the foreground both send it: the phone's points and battery,
 * with the background task's own location token (it can only send reports, and lasts as long as the session that
 * asked for it).
 */

/** The background task's name; never change it, or phones that already run it keep the old one. */
export const LOCATION_TASK = 'family-circle-location';
const TOKEN_KEY = 'familyCircle.locationToken';

/** The backend keeps the newest point only; a backlog after a dead zone is cut to its newest points. */
const MAX_POINTS = 200;

export const readLocationToken = () => backgroundSecureStorage.getItem(TOKEN_KEY);
export const saveLocationToken = (token: string) => backgroundSecureStorage.setItem(TOKEN_KEY, token);
export const forgetLocationToken = () => backgroundSecureStorage.deleteItem(TOKEN_KEY);

export function pointOf(location: LocationObject): LocationPoint {
  return {
    lat: location.coords.latitude,
    lng: location.coords.longitude,
    accuracyM: location.coords.accuracy ?? 0,
    at: new Date(location.timestamp).toISOString(),
  };
}

/** The phone's battery, or null where it can't tell (a simulator, the web). */
export async function readBattery(): Promise<BatteryInfo | null> {
  try {
    const [level, state] = await Promise.all([Battery.getBatteryLevelAsync(), Battery.getBatteryStateAsync()]);
    if (level < 0) return null;
    return { level, charging: state === Battery.BatteryState.CHARGING || state === Battery.BatteryState.FULL };
  } catch {
    return null;
  }
}

export type ReportOutcome =
  /** Sent; keep going, live until `liveUntil` (null: normal updates). */
  | { kind: 'sent'; liveUntil: number | null }
  /** The person shares in no Circle any more: stop the updates. */
  | { kind: 'stop' }
  /** Signed out, or the token ended: stop and forget the token. */
  | { kind: 'signedOut' }
  /** No signal, or the backend busy: the next update tries again. */
  | { kind: 'retry' };

/** Sends these positions with the stored location token. */
export async function reportWithToken(locations: readonly LocationObject[]): Promise<ReportOutcome> {
  if (locations.length === 0) return { kind: 'retry' };
  const token = await readLocationToken();
  if (!token) return { kind: 'signedOut' };
  return send(locations, token);
}

async function send(locations: readonly LocationObject[], bearer: string): Promise<ReportOutcome> {
  try {
    const points = locations.slice(-MAX_POINTS).map(pointOf);
    const result: LocationReportResult = await sendLocationReport({ points, battery: await readBattery() }, bearer);
    return result.sharing ? { kind: 'sent', liveUntil: result.liveUntil ?? null } : { kind: 'stop' };
  } catch (error) {
    if (error instanceof EmsError && error.code === 'unauthorized') return { kind: 'signedOut' };
    return { kind: 'retry' };
  }
}
