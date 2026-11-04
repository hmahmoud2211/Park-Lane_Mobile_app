/**
 * Turn-by-turn directions from a gate to a bay, computed from the site's road
 * graph (site.ts) rather than written by hand, so changing the layout changes
 * every route consistently.
 *
 * Shortest path is plain Dijkstra over the graph. Roads run both ways; the
 * basement aisles are one-way loops, so their edges are directed. The spoken
 * steps come from the geometry: a turn is left or right by the sign of the
 * cross product between the incoming and outgoing direction (map y grows
 * downward, so a positive cross product is a right turn), and the bay's side
 * is found the same way.
 */
import { describeStep } from './i18n';
import { ramps, roadEdges, roadNodes, zoneLayouts, type RoadEdge, type RoadNode } from './site';
import type { Gate, MapPoint, MapRect, ParkingSpace, RouteStep, RouteStepInfo, RouteStepKind, SpaceRoute } from './types';

/** A ramp is short on the map but slow to drive. */
const RAMP_COST = 45;

type RoutableSpace = Pick<ParkingSpace, 'label' | 'zoneId' | 'levelId' | 'map'>;

const centre = (r: MapRect): MapPoint => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
const sub = (a: MapPoint, b: MapPoint) => ({ x: a.x - b.x, y: a.y - b.y });
const len = (v: MapPoint) => Math.hypot(v.x, v.y);
const unit = (v: MapPoint) => {
  const l = len(v) || 1;
  return { x: v.x / l, y: v.y / l };
};
const dot = (a: MapPoint, b: MapPoint) => a.x * b.x + a.y * b.y;
const cross = (a: MapPoint, b: MapPoint) => a.x * b.y - a.y * b.x;

const nodeById = new Map(roadNodes.map((n) => [n.id, n]));

function outgoing(nodeId: string): { to: RoadNode; edge: RoadEdge; cost: number }[] {
  const from = nodeById.get(nodeId)!;
  const out: { to: RoadNode; edge: RoadEdge; cost: number }[] = [];
  for (const edge of roadEdges) {
    const forward = edge.from === nodeId;
    // Aisles are one-way; roads and ramps can be driven both ways.
    const backward = edge.to === nodeId && edge.kind !== 'aisle';
    if (!forward && !backward) continue;
    const to = nodeById.get(forward ? edge.to : edge.from)!;
    out.push({ to, edge, cost: edge.kind === 'ramp' ? RAMP_COST : len(sub(to, from)) });
  }
  return out;
}

interface Reached {
  cost: number;
  prev?: { nodeId: string; edge: RoadEdge };
}

function shortestFrom(startId: string): Map<string, Reached> {
  const reached = new Map<string, Reached>([[startId, { cost: 0 }]]);
  const open = new Set<string>([startId]);
  while (open.size) {
    let current = '';
    let best = Number.POSITIVE_INFINITY;
    for (const id of open) {
      const cost = reached.get(id)!.cost;
      if (cost < best) {
        best = cost;
        current = id;
      }
    }
    open.delete(current);
    for (const { to, edge, cost } of outgoing(current)) {
      const next = best + cost;
      if (next < (reached.get(to.id)?.cost ?? Number.POSITIVE_INFINITY)) {
        reached.set(to.id, { cost: next, prev: { nodeId: current, edge } });
        open.add(to.id);
      }
    }
  }
  return reached;
}

type Place = MapPoint & { levelId: RoadNode['levelId']; id?: string };

interface Hop {
  from: Place;
  to: Place;
  edge: RoadEdge;
}

function hopsTo(reached: Map<string, Reached>, targetId: string): Hop[] {
  const hops: Hop[] = [];
  let id = targetId;
  while (reached.get(id)?.prev) {
    const { nodeId, edge } = reached.get(id)!.prev!;
    hops.unshift({ from: nodeById.get(nodeId)!, to: nodeById.get(id)!, edge });
    id = nodeId;
  }
  return hops;
}

/** Nearest point to `p` on the segment a–b. */
function project(p: MapPoint, a: MapPoint, b: MapPoint): MapPoint {
  const ab = sub(b, a);
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / (dot(ab, ab) || 1)));
  return { x: a.x + ab.x * t, y: a.y + ab.y * t };
}

function cardinal(dir: MapPoint): 'north' | 'south' | 'east' | 'west' {
  if (Math.abs(dir.x) >= Math.abs(dir.y)) return dir.x > 0 ? 'east' : 'west';
  return dir.y > 0 ? 'south' : 'north';
}

type Turn = 'left' | 'right' | 'straight';

function turnBetween(before: MapPoint, after: MapPoint): Turn {
  if (dot(before, after) > 0.9) return 'straight';
  return cross(before, after) > 0 ? 'right' : 'left';
}

/** A step with its English wording written from its facts (see i18n.ts). */
const step = (kind: RouteStepKind, levelId: RouteStep['levelId'], info: RouteStepInfo, points: MapPoint[]): RouteStep => ({
  kind,
  levelId,
  info,
  text: describeStep(kind, info, 'en'),
  points,
});

/**
 * The route from `gate` to `space`, with the walk from the bay to the
 * building. `zoneSpaces` are the bays of the same zone, used to say "the third
 * bay on your right".
 */
export function computeRoute(
  space: RoutableSpace,
  gate: Pick<Gate, 'id' | 'name'>,
  zoneSpaces: readonly RoutableSpace[],
): SpaceRoute {
  const layout = zoneLayouts[space.zoneId];
  const [uId, vId] = layout.attach;
  const u = nodeById.get(uId)!;
  const v = nodeById.get(vId)!;
  const attachEdge = roadEdges.find(
    (e) => (e.from === uId && e.to === vId) || (e.from === vId && e.to === uId),
  )!;
  const bay = centre(space.map);
  const access = project(bay, u, v);
  const reached = shortestFrom(gate.id);

  // Arrive along the attaching edge from whichever end is closer; aisles only from their start.
  const viaU = (reached.get(uId)?.cost ?? Infinity) + len(sub(access, u));
  const viaV = attachEdge.kind === 'aisle' ? Infinity : (reached.get(vId)?.cost ?? Infinity) + len(sub(access, v));
  const entry = viaU <= viaV ? u : v;
  const accessNode = { ...access, levelId: entry.levelId };
  const hops: Hop[] = [...hopsTo(reached, entry.id), { from: entry, to: accessNode, edge: attachEdge }];

  // Group hops into runs along one named road or aisle.
  const runs: Hop[][] = [];
  for (const hop of hops) {
    const last = runs[runs.length - 1];
    if (last && hop.edge.kind !== 'ramp' && last[0].edge.kind !== 'ramp' && last[0].edge.name === hop.edge.name) {
      last.push(hop);
    } else {
      runs.push([hop]);
    }
  }

  const gateNode = nodeById.get(gate.id)!;
  const steps: RouteStep[] = [step('enter', gateNode.levelId, { gateId: gate.id }, [{ x: gateNode.x, y: gateNode.y }])];
  let heading: MapPoint | null = null;
  let carried: MapPoint[] = [];
  let afterRamp = false;

  for (const run of runs) {
    const first = run[0];
    if (first.edge.kind === 'ramp') {
      const ramp = ramps.find((r) => r.topNodeId === first.from.id || r.topNodeId === first.to.id)!;
      steps.push(step('ramp', first.from.levelId, { toLevel: ramp.toLevel }, ramp.groundPath));
      carried = [...ramp.landingPath];
      heading = unit(sub(ramp.landingPath[ramp.landingPath.length - 1], ramp.landingPath[0]));
      afterRamp = true;
      continue;
    }
    const points = [first.from, ...run.map((h) => h.to)].map(({ x, y }) => ({ x, y }));
    const startDir = unit(sub(points[1], points[0]));
    const endDir = unit(sub(points[points.length - 1], points[points.length - 2]));
    if (first.edge.silent) {
      carried = carried.length ? [...carried, ...points.slice(1)] : points;
      heading = endDir;
      continue;
    }
    let kind: RouteStepKind = 'head';
    const info: RouteStepInfo = { road: first.edge.name, heading: cardinal(startDir) };
    if (heading) {
      const turn = turnBetween(heading, startDir);
      kind = turn === 'straight' ? 'continue' : turn === 'left' ? 'turn-left' : 'turn-right';
      delete info.heading;
      if (turn !== 'straight') info.turn = turn;
      if (afterRamp) info.afterRamp = true;
    }
    steps.push(step(kind, first.from.levelId, info, carried.length ? [...carried, ...points.slice(1)] : points));
    carried = [];
    heading = endDir;
    afterRamp = false;
  }

  // Which side the bay is on, and how many bays of the zone come before it.
  const travel = heading ?? { x: 1, y: 0 };
  const side = cross(travel, sub(bay, access)) > 0 ? 'right' : 'left';
  const runStart = steps[steps.length - 1].points[0];
  const along = (s: RoutableSpace) => dot(sub(project(centre(s.map), u, v), runStart), travel);
  const mine = along(space);
  const position = zoneSpaces.filter((s) => along(s) >= -0.5 && along(s) <= mine + 0.5).length;
  steps.push(step('park', space.levelId, { bay: space.label, ordinal: position, side }, [access, bay]));

  const { walk } = layout;
  return {
    steps,
    walk: step('walk', space.levelId, { walkTo: walk.target }, [bay, { x: bay.x, y: walk.viaY }, { x: walk.to.x, y: walk.viaY }, walk.to]),
  };
}

/** The route as one paragraph, for sharing and for screen readers. */
export function routeText(route: SpaceRoute): string {
  const parts = route.steps.map((s) => s.text);
  if (route.walk) parts.push(`Then ${route.walk.text.charAt(0).toLowerCase()}${route.walk.text.slice(1)}`);
  return `${parts.join('. ')}.`;
}
