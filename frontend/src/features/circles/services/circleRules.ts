import { brand } from '../../../config/brand';
import type { BatteryInfo, Circle, CircleMember, MemberPosition } from '../types';

/** Rules for showing a Family Circle, with no React or network (circleRules.checks.ts checks them). */

/** "Just now", "5 min ago", "3 h ago", "Yesterday", or the date, for when a position was taken. */
export function lastSeenLabel(at: string, nowMs: number = Date.now()): string {
  const ms = nowMs - Date.parse(at);
  if (!Number.isFinite(ms) || ms < 60_000) return 'Just now';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  if (hours < 48) return 'Yesterday';
  return new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

export const batteryLabel = (battery: BatteryInfo) => `${Math.round(battery.level * 100)}%${battery.charging ? ' · charging' : ''}`;

/** The chip colour for a battery level: red at 15% and under, amber at 30% and under. */
export function batteryTone(battery: BatteryInfo): 'red' | 'amber' | 'teal' {
  if (battery.charging) return 'teal';
  if (battery.level <= 0.15) return 'red';
  if (battery.level <= 0.3) return 'amber';
  return 'teal';
}

export type MemberState =
  /** Shares and has a position. */
  | 'located'
  /** Shares, but no position has arrived yet (or sharing just started). */
  | 'waiting'
  | 'notSharing';

export function memberState(member: CircleMember): MemberState {
  if (!member.sharing) return 'notSharing';
  return member.location ? 'located' : 'waiting';
}

/** Members with a position, for the map. */
export const locatedMembers = (circle: Circle) => circle.members.filter((member) => member.location !== null);

export interface MapCamera {
  latitude: number;
  longitude: number;
  zoom: number;
}

/** Where the map opens: centred on everyone it shows, zoomed so they all fit (roughly), or null with nobody. */
export function cameraFor(members: readonly CircleMember[]): MapCamera | null {
  const points = members.flatMap((member) => (member.location ? [member.location] : []));
  if (points.length === 0) return null;
  const lats = points.map((point) => point.lat);
  const lngs = points.map((point) => point.lng);
  const span = Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lngs) - Math.min(...lngs));
  // A span of 360° is zoom 0; each zoom level halves it. One more level out leaves a margin around the dots.
  const zoom = span < 0.002 ? 15 : Math.min(15, Math.max(3, Math.floor(Math.log2(360 / span)) - 1));
  return {
    latitude: (Math.max(...lats) + Math.min(...lats)) / 2,
    longitude: (Math.max(...lngs) + Math.min(...lngs)) / 2,
    zoom,
  };
}

/** Further than this (about 2 km) a pin jumps instead of sliding: it was off for a while, not moving. */
const GLIDE_MAX_DEGREES = 0.02;

/**
 * Where a sliding pin is drawn, `progress` (0..1) of the way from `from` to `to`, easing out so it settles gently.
 * A far jump lands at once.
 */
export function glideStep(from: { lat: number; lng: number }, to: { lat: number; lng: number }, progress: number): { lat: number; lng: number } {
  const far = Math.abs(to.lat - from.lat) > GLIDE_MAX_DEGREES || Math.abs(to.lng - from.lng) > GLIDE_MAX_DEGREES;
  if (far || progress >= 1) return { lat: to.lat, lng: to.lng };
  const eased = 1 - (1 - Math.max(0, progress)) ** 2;
  return { lat: from.lat + (to.lat - from.lat) * eased, lng: from.lng + (to.lng - from.lng) * eased };
}

/** The Circles with one person's new position put in, wherever they share (a `location.updated` event). */
export function withPosition(circles: readonly Circle[], position: MemberPosition): Circle[] {
  return circles.map((circle) => ({
    ...circle,
    members: circle.members.map((member) =>
      member.userId === position.userId && member.sharing ? { ...member, location: position.location, battery: position.battery } : member,
    ),
  }));
}

/** The message an owner shares with the invite code. */
export function circleInviteMessage(circleName: string, code: string, appName: string = brand.appName): string {
  return `Join my Family Circle "${circleName}" in the ${appName} app: open Family Circle, tap "Join with a code" and enter ${code}. The code works once, for 24 hours.`;
}
