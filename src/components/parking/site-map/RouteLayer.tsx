/**
 * The route on the site map: the whole way faintly, the current step lit
 * with moving dashes and arrowheads, the walk to the building, and markers
 * for where the driver comes in and where the bay is.
 */
import { useEffect, useState } from 'react';
import { Circle, G, Rect, Text as SvgText } from 'react-native-svg';

import { useAppTheme } from '../../../hooks/useAppTheme';
import type { Lang } from '../../../services/parking/i18n';
import { MAP_SIZE } from '../../../services/parking/site';
import type { LevelId, MapPoint, RouteStep } from '../../../services/parking/types';
import { pointsAlong } from './mapModel';
import { mapStrings } from './mapStrings';

/** Re-renders its owner every `intervalMs` while `active`, for small looping animations. */
function useTicker(active: boolean, intervalMs: number): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((t) => t + 1), intervalMs);
    return () => clearInterval(id);
  }, [active, intervalMs]);
  return tick;
}

/** Distance between the glowing dots, and how far the bright wave travels before it repeats. */
const DOT_SPACING = 10;
const WAVE = 72;

/**
 * A route drawn only as glowing dots that stream along it the way the driver
 * or walker goes, with a brighter wave running ahead through them. Still
 * (evenly lit) when the system asks for reduced motion.
 */
function FlowingPath({
  points,
  color,
  glow,
  size,
  still,
}: {
  points: readonly MapPoint[];
  color: string;
  glow: string;
  size: number;
  still: boolean;
}) {
  const tick = useTicker(!still, 50);
  const shift = still ? 0 : (tick * 0.9) % DOT_SPACING;
  const front = still ? 0 : (tick * 2.4) % WAVE;
  return (
    <G>
      {pointsAlong(points, DOT_SPACING, shift).map((p, i) => {
        // 1 at the wave's crest, easing to a resting glow behind it.
        const behind = (((front - p.at) % WAVE) + WAVE) % WAVE;
        const lift = still ? 0.5 : Math.max(0, 1 - behind / (WAVE * 0.6));
        return (
          <G key={i}>
            <Circle cx={p.x} cy={p.y} r={size * (2 + lift * 1.4)} fill={glow} opacity={0.7 + lift * 0.3} />
            <Circle cx={p.x} cy={p.y} r={size * (0.75 + lift * 0.45)} fill={color} opacity={0.75 + lift * 0.25} />
          </G>
        );
      })}
    </G>
  );
}

/** Joins consecutive steps into one path, dropping the point each pair shares. */
function joined(paths: readonly (readonly MapPoint[])[]): MapPoint[] {
  const out: MapPoint[] = [];
  for (const path of paths) {
    for (const p of path) {
      const last = out[out.length - 1];
      if (!last || last.x !== p.x || last.y !== p.y) out.push(p);
    }
  }
  return out;
}

function Pulse({ point, color, still }: { point: MapPoint; color: string; still: boolean }) {
  const tick = useTicker(!still, 60);
  const phase = still ? 0.45 : (tick % 26) / 26;
  return (
    <Circle cx={point.x} cy={point.y} r={7 + phase * 11} fill="none" stroke={color} strokeWidth={2} opacity={0.65 * (1 - phase)} />
  );
}

type Placement = 'above' | 'below' | 'right' | 'left';

/** A pill with text beside a point, kept inside the canvas. */
function Callout({ at, text, fill, textColor, place = 'above' }: { at: MapPoint; text: string; fill: string; textColor: string; place?: Placement }) {
  const theme = useAppTheme();
  const size = theme.typography.label.fontSize;
  const width = text.length * size * 0.56 + 14;
  const left = place === 'right' ? at.x + 4 : place === 'left' ? at.x - width - 4 : at.x - width / 2;
  const x = Math.min(Math.max(left, 4), MAP_SIZE.width - width - 4);
  const y = place === 'below' ? at.y + 14 : place === 'above' ? at.y - 30 : at.y - 10;
  return (
    <G>
      <Rect x={x} y={y} width={width} height={20} rx={10} fill={fill} />
      <SvgText fontFamily={theme.fontFamily.semiBold} x={x + width / 2} y={y + 14} fontSize={size} fill={textColor} textAnchor="middle">
        {text}
      </SvgText>
    </G>
  );
}

export interface RouteLayerProps {
  levelId: LevelId;
  /** Drive steps and the walk, in order (see mapModel `allSteps`). */
  steps: readonly RouteStep[];
  showWalk: boolean;
  gate?: MapPoint;
  destination?: { point: MapPoint; label: string; levelId: LevelId };
  /** Where the route arrives on a basement: beside the ramp landing. */
  arrival?: { point: MapPoint; levelId: LevelId; side: 'left' | 'right' };
  still: boolean;
  lang: Lang;
  /** The gate and ramp callouts; off while choosing a bay, where they only add clutter. */
  callouts?: boolean;
}

export function RouteLayer({ levelId, steps, showWalk, gate, destination, arrival, still, lang, callouts = true }: RouteLayerProps) {
  const { colors } = useAppTheme();
  const str = mapStrings(lang);
  const here = steps.filter((s) => s.levelId === levelId);
  const drive = joined(here.filter((s) => s.kind !== 'walk' && s.kind !== 'enter' && s.points.length > 1).map((s) => s.points));
  const walk = here.find((s) => s.kind === 'walk');
  // The route goes on below this level: pulse where it leaves (the ramp), which is also a tap target.
  const lastHere = here.length ? steps.indexOf(here[here.length - 1]) : -1;
  const continues = lastHere >= 0 && lastHere < steps.length - 1 && steps[lastHere + 1].levelId !== levelId;

  return (
    <G>
      {drive.length > 1 ? (
        <FlowingPath points={drive} color={colors.mapRoute} glow={colors.mapRouteGlow} size={2.5} still={still} />
      ) : null}

      {continues && drive.length > 1 ? <Pulse point={drive[drive.length - 1]} color={colors.mapRoute} still={still} /> : null}

      {walk && showWalk && walk.points.length > 1 ? (
        <G>
          <FlowingPath points={walk.points} color={colors.mapWalk} glow={colors.mapWalkGlow} size={2.1} still={still} />
          <Circle cx={walk.points[walk.points.length - 1].x} cy={walk.points[walk.points.length - 1].y} r={3.5} fill={colors.mapWalk} />
        </G>
      ) : null}

      {gate && levelId === 'ground' && callouts ? (
        <G>
          <Pulse point={gate} color={colors.mapGate} still={still} />
          <Callout at={gate} text={str.youEnterHere} fill={colors.mapGate} textColor={colors.backgroundDeep} place="below" />
        </G>
      ) : null}

      {callouts && arrival && arrival.levelId === levelId ? (
        <Callout at={arrival.point} text={str.fromRamp} fill={colors.mapGate} textColor={colors.backgroundDeep} place={arrival.side} />
      ) : null}

      {destination && destination.levelId === levelId ? (
        <G>
          <Pulse point={destination.point} color={colors.mapTarget} still={still} />
          <Callout at={destination.point} text={destination.label} fill={colors.mapTarget} textColor={colors.backgroundDeep} />
        </G>
      ) : null}
    </G>
  );
}
