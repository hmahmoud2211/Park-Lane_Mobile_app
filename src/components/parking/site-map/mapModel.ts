import { chargerFreeNow, isAvailableNow } from '../../../services/parking/availability';
import { MAP_SIZE, levels, type LevelDef } from '../../../services/parking/site';
import type { Charger, LevelId, MapPoint, MapRect, ParkingDb, ParkingSpace, RouteStep } from '../../../services/parking/types';

/** What a bay shows: live status, or availability for a chosen time when booking. */
export type BayState = 'free' | 'taken' | 'occupied' | 'reserved' | 'closed' | 'unknown' | 'neutral';

/** A bay's state right now, from its physical occupancy and current bookings. */
export function liveBayState(db: ParkingDb, space: ParkingSpace, now: number): BayState {
  if (space.serviceability !== 'in-service') return 'closed';
  if (space.occupancy === 'unknown') return 'unknown';
  if (space.occupancy === 'occupied') return 'occupied';
  return isAvailableNow(db, space, now) ? 'free' : 'reserved';
}

export type ChargerState = 'available' | 'busy' | 'fault';

export function chargerState(db: ParkingDb, charger: Charger, now: number): ChargerState {
  if (charger.status !== 'available') return 'fault';
  return chargerFreeNow(db, charger, now) ? 'available' : 'busy';
}

/* -------------------------------------------------------------- Geometry */

export const rectCentre = (r: MapRect): MapPoint => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

export function centroid(points: readonly MapPoint[]): MapPoint {
  if (points.length === 0) return { x: MAP_SIZE.width / 2, y: MAP_SIZE.height / 2 };
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { x: (Math.min(...xs) + Math.max(...xs)) / 2, y: (Math.min(...ys) + Math.max(...ys)) / 2 };
}

export function boundsOf(rects: readonly MapRect[], pad = 0): MapRect {
  const x = Math.min(...rects.map((r) => r.x)) - pad;
  const y = Math.min(...rects.map((r) => r.y)) - pad;
  const right = Math.max(...rects.map((r) => r.x + r.w)) + pad;
  const bottom = Math.max(...rects.map((r) => r.y + r.h)) + pad;
  return { x, y, w: right - x, h: bottom - y };
}

export const pointsAttr = (points: readonly MapPoint[]) => points.map((p) => `${p.x},${p.y}`).join(' ');

/**
 * Small arrowheads every `spacing` units along a path, pointing the way of
 * travel, drawn as triangles so no SVG transforms are needed.
 */
/**
 * Evenly spaced points along a path, each with its distance from the start.
 * `shift` slides them forward, to animate a flow.
 */
export function pointsAlong(points: readonly MapPoint[], spacing: number, shift = 0): (MapPoint & { at: number })[] {
  const out: (MapPoint & { at: number })[] = [];
  let travelled = 0;
  let next = shift % spacing;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length === 0) continue;
    while (next <= travelled + length) {
      const t = (next - travelled) / length;
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, at: next });
      next += spacing;
    }
    travelled += length;
  }
  return out;
}

/** Arrowheads along a path, pointing the way it runs. `shift` slides them forward, to animate the flow. */
export function chevronsAlong(points: readonly MapPoint[], spacing: number, size = 3.2, shift = 0): string[] {
  const out: string[] = [];
  let travelled = 0;
  let next = (spacing / 2 + shift) % spacing;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1];
    const b = points[i];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length === 0) continue;
    const d = { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
    const n = { x: -d.y, y: d.x };
    while (next < travelled + length) {
      const t = next - travelled;
      const p = { x: a.x + d.x * t, y: a.y + d.y * t };
      const tip = { x: p.x + d.x * size, y: p.y + d.y * size };
      const left = { x: p.x - d.x * size + n.x * size, y: p.y - d.y * size + n.y * size };
      const right = { x: p.x - d.x * size - n.x * size, y: p.y - d.y * size - n.y * size };
      out.push(pointsAttr([tip, left, right]));
      next += spacing;
    }
    travelled += length;
  }
  return out;
}

/* ------------------------------------------------------------- Levels */

/** The levels the map offers, in order. */
export function levelsFor(opts: {
  privacy: boolean;
  routeLevels: readonly LevelId[];
  extra?: readonly LevelId[];
}): LevelDef[] {
  if (!opts.privacy) return [...levels];
  // A visitor sees only the levels their own route uses.
  const wanted = new Set<LevelId>(['ground', ...opts.routeLevels, ...(opts.extra ?? [])]);
  return levels.filter((l) => wanted.has(l.id));
}

/** All the steps of a route, the walk included, as one list. */
export function allSteps(route: { steps: RouteStep[]; walk?: RouteStep } | undefined): RouteStep[] {
  if (!route) return [];
  return route.walk ? [...route.steps, route.walk] : route.steps;
}
