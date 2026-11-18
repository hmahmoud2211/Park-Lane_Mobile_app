import type { BatteryInfo, LocationPoint, LocationReportResult, MemberPosition } from '../../../shared/contracts/circles.ts';
import type { User } from '../ems/auth.ts';
import { publishToUsers } from '../ems/broadcast.ts';
import { seal, unseal } from '../ems/secrets.ts';
import { ApiError } from '../errors.ts';
import { sharesAnywhere, viewerIdsOf } from '../repositories/circles.ts';
import { findMemberLocation, type MemberLocationRow, updateMemberBattery, upsertMemberLocation } from '../repositories/memberLocations.ts';
import { liveUntilOf } from './live.ts';

/**
 * Family Circle positions (docs/plans/FAMILY_CIRCLE_PLAN.md). A phone reports the points it collected and its
 * battery; the backend keeps only the newest point, sealed, and pushes it to the people in a Circle where that person
 * shares. Someone who shares nowhere is told so (`sharing: false`) and nothing is saved, so a phone that missed the
 * switch being turned off stops by itself.
 */

export const MAX_POINTS = 200;
const MAX_ACCURACY_M = 1000;
const MAX_FUTURE_MS = 2 * 60_000;
const MAX_AGE_MS = 24 * 3600_000;

const bad = (message: string) => new ApiError('bad_request', message);

function pointOf(input: unknown, now: number): { point: LocationPoint; atMs: number } {
  const raw = (input ?? {}) as Record<string, unknown>;
  const { lat, lng, accuracyM, at } = raw;
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) throw bad('Each point needs a latitude from -90 to 90.');
  if (typeof lng !== 'number' || !Number.isFinite(lng) || lng < -180 || lng > 180) throw bad('Each point needs a longitude from -180 to 180.');
  if (typeof accuracyM !== 'number' || !Number.isFinite(accuracyM) || accuracyM < 0) throw bad('Each point needs its accuracy in metres.');
  const atMs = typeof at === 'string' ? Date.parse(at) : Number.NaN;
  if (!Number.isFinite(atMs)) throw bad('Each point needs the time it was taken.');
  if (accuracyM > MAX_ACCURACY_M || atMs > now + MAX_FUTURE_MS || atMs < now - MAX_AGE_MS) {
    // Too rough, from the future or too old: dropped quietly rather than failing the points around it.
    return { point: { lat, lng, accuracyM, at: new Date(atMs).toISOString() }, atMs: Number.NaN };
  }
  return { point: { lat, lng, accuracyM: Math.round(accuracyM), at: new Date(atMs).toISOString() }, atMs };
}

function batteryOf(input: unknown): BatteryInfo | null {
  if (input === null || input === undefined) return null;
  const { level, charging } = input as Record<string, unknown>;
  if (typeof level !== 'number' || !Number.isFinite(level) || level < 0 || level > 1 || typeof charging !== 'boolean') {
    throw bad('The battery needs a level from 0 to 1 and whether it is charging.');
  }
  return { level: Math.round(level * 100) / 100, charging };
}

/** A saved row as the people who may see it get it. */
export function positionOf(userId: string, row: MemberLocationRow | null | undefined): MemberPosition {
  if (!row) {
    return { userId, location: null, battery: null };
  }
  let location: LocationPoint | null = null;
  try {
    const sealed = JSON.parse(unseal(row.point)) as { lat: number; lng: number; accuracyM: number };
    location = { lat: sealed.lat, lng: sealed.lng, accuracyM: sealed.accuracyM, at: new Date(row.at).toISOString() };
  } catch {
    // A row sealed with another key (a restored database): show no position rather than fail the Circle.
  }
  const battery = row.batteryLevel === null || row.charging === null ? null : { level: row.batteryLevel, charging: row.charging };
  return { userId, location, battery };
}

/** POST /api/location/report. */
export function reportLocation(user: User, body: Record<string, unknown>, now = Date.now()): LocationReportResult {
  if (!Array.isArray(body.points) || body.points.length === 0) {
    throw bad('Send at least one point.');
  }
  if (body.points.length > MAX_POINTS) {
    throw bad(`Send at most ${MAX_POINTS} points at a time.`);
  }
  const points = body.points.map((point) => pointOf(point, now));
  const battery = batteryOf(body.battery);
  if (!sharesAnywhere(user.id)) {
    return { accepted: false, sharing: false, liveUntil: null };
  }

  const newest = points.filter((point) => Number.isFinite(point.atMs)).sort((a, b) => b.atMs - a.atMs)[0];
  const saved = findMemberLocation(user.id);
  let accepted = false;
  if (newest && (!saved || newest.atMs > saved.at)) {
    const { lat, lng, accuracyM } = newest.point;
    upsertMemberLocation({
      userId: user.id,
      point: seal(JSON.stringify({ lat, lng, accuracyM })),
      at: newest.atMs,
      batteryLevel: battery?.level ?? null,
      charging: battery?.charging ?? null,
      updatedAt: now,
    });
    accepted = true;
  } else if (saved && battery) {
    updateMemberBattery(user.id, battery.level, battery.charging, now);
  } else {
    return { accepted: false, sharing: true, liveUntil: liveUntilOf(user.id, now) };
  }
  publishToUsers(viewerIdsOf(user.id), { type: 'location.updated', member: positionOf(user.id, findMemberLocation(user.id)) });
  return { accepted, sharing: true, liveUntil: liveUntilOf(user.id, now) };
}
