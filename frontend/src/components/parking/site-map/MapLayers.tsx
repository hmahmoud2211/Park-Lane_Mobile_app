/**
 * The drawn parts of the site map that do not move with the route: the
 * level's ground plan, its bays, chargers and gates. Each layer is memoised,
 * so panning and the route animation never redraw the whole compound.
 */
import { memo } from 'react';
import { Circle, Defs, G, Line, Pattern, Polygon, Polyline, Rect, Text as SvgText } from 'react-native-svg';

import { useAppTheme } from '../../../hooks/useAppTheme';
import type { Lang } from '../../../services/parking/i18n';
import {
  MAP_SIZE,
  aisleLabels,
  columns,
  landscape,
  lifts,
  otherBayNotes,
  otherBays,
  ramps,
  roads,
  walkways,
} from '../../../services/parking/site';
import type { Building, Charger, Connector, Gate, LevelId, MapRect, ParkingSpace } from '../../../services/parking/types';
import { chevronsAlong, pointsAttr, rectCentre, type BayState, type ChargerState } from './mapModel';
import { mapStrings } from './mapStrings';

const W = MAP_SIZE.width;
const H = MAP_SIZE.height;

function useMapText() {
  const theme = useAppTheme();
  return {
    font: theme.fontFamily.medium,
    bold: theme.fontFamily.semiBold,
    tiny: theme.typography.tileCaption.fontSize,
    small: theme.typography.statLabel.fontSize,
    label: theme.typography.label.fontSize,
  };
}

/** Warm lights spaced along a wall, as in a lit garage. Decoration only. */
function WallLights({ rect, inset = 5, spacing = 30 }: { rect: MapRect; inset?: number; spacing?: number }) {
  const { colors } = useAppTheme();
  const points: { x: number; y: number }[] = [];
  const left = rect.x + inset;
  const right = rect.x + rect.w - inset;
  const top = rect.y + inset;
  const bottom = rect.y + rect.h - inset;
  for (let x = left + spacing / 2; x < right; x += spacing) {
    points.push({ x, y: top }, { x, y: bottom });
  }
  for (let y = top + spacing; y < bottom - spacing / 2; y += spacing) {
    points.push({ x: left, y }, { x: right, y });
  }
  return (
    <G>
      {points.map((p) => (
        <G key={`${p.x}-${p.y}`}>
          <Circle cx={p.x} cy={p.y} r={4} fill={colors.mapLightGlow} />
          <Circle cx={p.x} cy={p.y} r={1.3} fill={colors.mapLight} />
        </G>
      ))}
    </G>
  );
}

/* ------------------------------------------------------------ Ground */

const GroundPlan = memo(function GroundPlan({ buildings, lang }: { buildings: readonly Building[]; lang: Lang }) {
  const { colors } = useAppTheme();
  const t = useMapText();
  const str = mapStrings(lang);
  const groundRoads = roads.filter((r) => r.levelId === 'ground');

  return (
    <G>
      <Rect x={0} y={0} width={W} height={H} rx={14} fill={colors.mapGround} />
      <Rect x={6} y={6} width={W - 12} height={H - 12} rx={16} fill="none" stroke={colors.mapBoundary} strokeWidth={2} />
      <WallLights rect={{ x: 6, y: 6, w: W - 12, h: H - 12 }} spacing={40} />

      {landscape
        .filter((l) => l.levelId === 'ground')
        .map((l) => {
          const look =
            l.kind === 'garden'
              ? { fill: colors.mapGreen, stroke: colors.mapGreenStroke }
              : l.kind === 'water'
                ? { fill: colors.mapWater, stroke: colors.mapWaterStroke }
                : { fill: colors.mapBuilding, stroke: colors.mapBuildingStroke };
          return (
            <G key={l.id}>
              <Rect x={l.x} y={l.y} width={l.w} height={l.h} rx={l.kind === 'water' ? 16 : 8} {...look} strokeDasharray={l.kind === 'landmark' ? '4 3' : undefined} />
              {l.kind === 'garden'
                ? [0.18, 0.4, 0.62, 0.84].map((f) => (
                    <Circle key={f} cx={l.x + l.w * f} cy={l.y + l.h * 0.62} r={5} fill={colors.mapGreenStroke} opacity={0.35} />
                  ))
                : null}
              {l.label ? (
                <SvgText
                  fontFamily={t.font}
                  x={l.x + l.w / 2}
                  y={l.kind === 'landmark' ? l.y + 16 : l.y + (l.kind === 'garden' ? 16 : l.h / 2 + 3)}
                  fontSize={t.small}
                  fill={colors.textSupport}
                  textAnchor="middle"
                >
                  {str.name(l.label)}
                </SvgText>
              ) : null}
            </G>
          );
        })}

      {walkways
        .filter((w) => w.levelId === 'ground')
        .map((w, i) => (
          <Polyline key={i} points={pointsAttr(w.points)} fill="none" stroke={colors.mapSidewalk} strokeWidth={8} strokeLinecap="round" />
        ))}

      {/* Kerbs first, then asphalt, then markings, so junctions join cleanly. */}
      {groundRoads.map((r) => (
        <Polyline key={`${r.id}-edge`} points={pointsAttr(r.points)} fill="none" stroke={colors.mapRoadEdge} strokeWidth={r.width + 3} strokeLinecap="square" />
      ))}
      {groundRoads.map((r) => (
        <Polyline key={`${r.id}-asphalt`} points={pointsAttr(r.points)} fill="none" stroke={colors.mapAsphalt} strokeWidth={r.width} strokeLinecap="square" />
      ))}
      {groundRoads.map((r) => (
        <Polyline key={`${r.id}-lane`} points={pointsAttr(r.points)} fill="none" stroke={colors.mapLaneMark} strokeWidth={1} strokeDasharray="6 6" />
      ))}
      {groundRoads.map((r) =>
        r.label ? (
          <SvgText key={`${r.id}-name`} fontFamily={t.font} x={r.label.x} y={r.label.y} fontSize={t.tiny} fill={colors.textSupport}>
            {str.name(r.name)}
          </SvgText>
        ) : null,
      )}

      {ramps.map((ramp) => (
        <G key={ramp.id}>
          <Rect x={ramp.ground.x} y={ramp.ground.y} width={ramp.ground.w} height={ramp.ground.h} rx={4} fill={colors.mapAsphalt} stroke={colors.mapRoadEdge} />
          {chevronsAlong(ramp.groundPath.slice(-2).map((p, i) => (i === 0 ? { x: p.x, y: ramp.ground.y } : p)), 12, 3.5).map((pts, i) => (
            <Polygon key={i} points={pts} fill={colors.mapLaneMark} />
          ))}
          <SvgText fontFamily={t.bold} x={ramp.ground.x + ramp.ground.w + 4} y={ramp.ground.y + 14} fontSize={t.small} fill={colors.textPrimary}>
            {str.rampDown(ramp.toLevel)[0]}
          </SvgText>
          <SvgText fontFamily={t.font} x={ramp.ground.x + ramp.ground.w + 4} y={ramp.ground.y + 25} fontSize={t.tiny} fill={colors.textSupport}>
            {str.rampDown(ramp.toLevel)[1]}
          </SvgText>
        </G>
      ))}

      {buildings.map((b) => (
        <G key={b.id}>
          <Rect x={b.map.x} y={b.map.y} width={b.map.w} height={b.map.h} rx={6} fill={colors.mapBuilding} stroke={colors.mapBuildingStroke} />
          <SvgText fontFamily={t.bold} x={b.map.x + b.map.w / 2} y={b.map.y + b.map.h / 2 + 4} fontSize={t.label} fill={colors.textPrimary} textAnchor="middle">
            {str.name(b.name)}
          </SvgText>
          {/* The pedestrian entrance. */}
          <Rect x={b.door.x - 7} y={b.door.y - 2} width={14} height={4} rx={2} fill={colors.textPrimary} opacity={0.85} />
        </G>
      ))}

      {/* Compass: north is up on every level. */}
      <G>
        <Circle cx={342} cy={20} r={9} fill={colors.mapGround} stroke={colors.textSupport} strokeWidth={0.8} />
        <Polygon points="342,12 345,21 342,19 339,21" fill={colors.textPrimary} />
        <SvgText fontFamily={t.bold} x={342} y={36} fontSize={t.tiny} fill={colors.textSupport} textAnchor="middle">
          {str.compass}
        </SvgText>
      </G>
    </G>
  );
});

/* --------------------------------------------------------- Basements */

const BasementPlan = memo(function BasementPlan({
  levelId,
  summary,
  titled,
  lang,
}: {
  levelId: LevelId;
  summary?: string;
  titled: boolean;
  lang: Lang;
}) {
  const { colors } = useAppTheme();
  const t = useMapText();
  const str = mapStrings(lang);
  const loop = roads.find((r) => r.levelId === levelId);
  const landing = ramps.find((r) => r.toLevel === levelId);

  return (
    <G>
      <Rect x={0} y={0} width={W} height={H} rx={14} fill={colors.mapGround} />
      {titled ? (
        <SvgText fontFamily={t.bold} x={18} y={24} fontSize={t.label} fill={colors.textPrimary}>
          {str.level(levelId)}
        </SvgText>
      ) : null}
      {titled && summary ? (
        <SvgText fontFamily={t.font} x={342} y={24} fontSize={t.small} fill={colors.textSupport} textAnchor="end">
          {summary}
        </SvgText>
      ) : null}
      <Rect x={16} y={36} width={W - 32} height={H - 72} rx={12} fill={colors.mapFloor} stroke={colors.mapBasementStroke} strokeWidth={1.5} />
      <WallLights rect={{ x: 16, y: 36, w: W - 32, h: H - 72 }} />

      {columns
        .filter((c) => c.levelId === levelId)
        .map((c) => (
          <Rect key={`${c.x}-${c.y}`} x={c.x - 3} y={c.y - 3} width={6} height={6} fill={colors.mapColumn} />
        ))}

      {loop ? (
        <G>
          <Polyline points={pointsAttr(loop.points)} fill="none" stroke={colors.mapRoadEdge} strokeWidth={loop.width + 3} strokeLinejoin="round" />
          <Polyline points={pointsAttr(loop.points)} fill="none" stroke={colors.mapAsphalt} strokeWidth={loop.width} strokeLinejoin="round" />
          {/* One-way arrows around the loop. */}
          {chevronsAlong(loop.points, 34, 3).map((pts, i) => (
            <Polygon key={i} points={pts} fill={colors.mapLaneMark} opacity={0.7} />
          ))}
        </G>
      ) : null}

      {landing ? (
        <G>
          <Rect x={landing.landing.x} y={landing.landing.y} width={landing.landing.w} height={landing.landing.h} rx={4} fill={colors.mapAsphalt} stroke={colors.mapRoadEdge} />
          <SvgText
            fontFamily={t.font}
            x={levelId === 'b1' ? landing.landing.x + landing.landing.w + 5 : landing.landing.x - 5}
            y={landing.landing.y + 18}
            fontSize={t.tiny}
            fill={colors.textSupport}
            textAnchor={levelId === 'b1' ? 'start' : 'end'}
          >
            {str.rampUp}
          </SvgText>
        </G>
      ) : null}

      {walkways
        .filter((w) => w.levelId === levelId)
        .map((w, i) => (
          <G key={i}>
            <Polyline points={pointsAttr(w.points)} fill="none" stroke={colors.mapSidewalk} strokeWidth={9} strokeLinecap="round" />
            <Polyline points={pointsAttr(w.points)} fill="none" stroke={colors.mapWalk} strokeWidth={1} strokeDasharray="2 4" opacity={0.6} />
          </G>
        ))}

      {otherBays
        .filter((b) => b.levelId === levelId)
        .map((b) => (
          <Rect key={`${b.x}-${b.y}`} x={b.x} y={b.y} width={b.w} height={b.h} rx={2} fill={colors.mapBayOther} stroke={colors.mapBayOtherStroke} strokeWidth={0.8} />
        ))}
      {otherBayNotes
        .filter((n) => n.levelId === levelId)
        .map((n) => (
          <SvgText key={n.text} fontFamily={t.font} x={n.x} y={n.y} fontSize={t.tiny} fill={colors.textMuted} textAnchor="middle">
            {str.name(n.text)}
          </SvgText>
        ))}

      {lifts
        .filter((l) => l.levelId === levelId)
        .map((l) => (
          <G key={l.id}>
            <Rect x={l.rect.x} y={l.rect.y} width={l.rect.w} height={l.rect.h} rx={5} fill={colors.mapLift} stroke={colors.violet} />
            <SvgText fontFamily={t.bold} x={l.rect.x + l.rect.w / 2} y={l.rect.y + 16} fontSize={t.small} fill={colors.textPrimary} textAnchor="middle">
              {str.name(l.label)}
            </SvgText>
            <SvgText fontFamily={t.font} x={l.rect.x + l.rect.w / 2} y={l.rect.y + 27} fontSize={t.tiny} fill={colors.textSupport} textAnchor="middle">
              {str.lobby}
            </SvgText>
          </G>
        ))}

      {aisleLabels
        .filter((a) => a.levelId === levelId)
        .map((a) => (
          <SvgText key={a.text} fontFamily={t.font} x={a.x} y={a.y} fontSize={t.tiny} fill={colors.textSupport} textAnchor={a.anchor}>
            {str.aisle(a.text)}
          </SvgText>
        ))}
    </G>
  );
});

export const LevelPlan = memo(function LevelPlan({
  levelId,
  buildings,
  summary,
  titled = true,
  lang,
}: {
  levelId: LevelId;
  buildings: readonly Building[];
  summary?: string;
  /** Off when the page names the level above the drawing. */
  titled?: boolean;
  lang: Lang;
}) {
  return levelId === 'ground' ? (
    <GroundPlan buildings={buildings} lang={lang} />
  ) : (
    <BasementPlan levelId={levelId} summary={summary} titled={titled} lang={lang} />
  );
});

/* -------------------------------------------------------------- Zones */

export interface ZoneOutline {
  id: string;
  rect: MapRect;
  label: string;
  /** Where the label is written, below the bays on the ground level. */
  labelAt?: { x: number; y: number };
}

export const ZoneLayer = memo(function ZoneLayer({ zones }: { zones: readonly ZoneOutline[] }) {
  const { colors } = useAppTheme();
  const t = useMapText();
  return (
    <G>
      {zones.map((z) => (
        <G key={z.id}>
          <Rect x={z.rect.x} y={z.rect.y} width={z.rect.w} height={z.rect.h} rx={5} fill={colors.mapZone} stroke={colors.mapZoneStroke} strokeDasharray="3 3" />
          {z.labelAt ? (
            <SvgText fontFamily={t.font} x={z.labelAt.x} y={z.labelAt.y} fontSize={t.tiny} fill={colors.textSupport}>
              {z.label}
            </SvgText>
          ) : null}
        </G>
      ))}
    </G>
  );
});

/* --------------------------------------------------------------- Bays */

const shortLabel = (label: string) =>
  label.startsWith('V-') ? label.slice(2).replace(/^0/, '') : label.startsWith('P2-') ? label.slice(3) : label;

/** A parked car seen from above, sized to its bay. Paint varies by bay so a row reads as real cars. */
function ParkedCar({ rect, seed }: { rect: MapRect; seed: string }) {
  const { colors } = useAppTheme();
  const paints = [colors.mapCarLight, colors.mapCarMid, colors.mapCarDark];
  const paint = paints[[...seed].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % paints.length];
  const bw = rect.w * 0.66;
  const bh = rect.h * 0.78;
  const x = rect.x + (rect.w - bw) / 2;
  const y = rect.y + (rect.h - bh) / 2;
  const glassInset = bw * 0.14;
  return (
    <G>
      <Rect x={x} y={y} width={bw} height={bh} rx={bw * 0.32} fill={paint} />
      {/* Windscreen, roof and rear window. */}
      <Rect x={x + glassInset} y={y + bh * 0.2} width={bw - glassInset * 2} height={bh * 0.17} rx={1.5} fill={colors.mapCarGlass} />
      <Rect x={x + glassInset} y={y + bh * 0.66} width={bw - glassInset * 2} height={bh * 0.12} rx={1.5} fill={colors.mapCarGlass} />
      <Rect x={x + 1} y={y + bh - 2} width={bw * 0.22} height={1.4} rx={0.7} fill={colors.mapCarTail} />
      <Rect x={x + bw - 1 - bw * 0.22} y={y + bh - 2} width={bw * 0.22} height={1.4} rx={0.7} fill={colors.mapCarTail} />
    </G>
  );
}

/**
 * Bays as a lit garage: an empty bay glows green, an occupied one glows red
 * around its parked car, a reserved one is hatched, and the chosen bay is lit
 * cyan. Numbers sit on the bays that have no car over them.
 */
export const BayLayer = memo(function BayLayer({
  spaces,
  states,
  targetId,
  showNumbers,
}: {
  spaces: readonly ParkingSpace[];
  states: Readonly<Record<string, BayState>>;
  targetId?: string;
  showNumbers: boolean;
}) {
  const { colors } = useAppTheme();
  const t = useMapText();

  const look = (state: BayState): { fill: string; stroke: string; glow?: string; strokeDasharray?: string } => {
    switch (state) {
      case 'free':
        return { fill: colors.mapBayFree, stroke: colors.mapBayFreeStroke, glow: colors.mapBayFreeGlow };
      case 'taken':
      case 'occupied':
        return { fill: colors.mapBayTaken, stroke: colors.mapBayTakenStroke, glow: colors.mapBayTakenGlow };
      case 'reserved':
        return { fill: 'url(#bay-hatch)', stroke: colors.mapBayReservedStroke };
      case 'closed':
      case 'unknown':
        return { fill: colors.mapBayOther, stroke: colors.mapBayStroke, strokeDasharray: '2 2' };
      case 'neutral':
        return { fill: colors.mapBay, stroke: colors.mapBayStroke };
    }
  };

  return (
    <G>
      <Defs>
        <Pattern id="bay-hatch" patternUnits="userSpaceOnUse" width={4} height={4} patternTransform="rotate(45)">
          <Rect x={0} y={0} width={4} height={4} fill={colors.mapBayReserved} />
          <Line x1={0} y1={0} x2={0} y2={4} stroke={colors.mapBayHatch} strokeWidth={1.4} />
        </Pattern>
      </Defs>
      {spaces.map((space) => {
        const isTarget = space.id === targetId;
        const state = states[space.id] ?? 'neutral';
        const { x, y, w, h } = space.map;
        const c = rectCentre(space.map);
        const glyph = state === 'closed' ? '×' : state === 'unknown' ? '?' : null;
        const style = look(state);
        const parked = !isTarget && state === 'occupied';
        return (
          <G key={space.id}>
            {style.glow && !isTarget ? (
              <Rect x={x - 1} y={y - 1} width={w + 2} height={h + 2} rx={4} fill="none" stroke={style.glow} strokeWidth={3} />
            ) : null}
            <Rect
              x={x}
              y={y}
              width={w}
              height={h}
              rx={3}
              strokeWidth={isTarget ? 2 : 1.3}
              {...(isTarget ? { fill: colors.mapTarget, stroke: colors.white } : style)}
            />
            {parked ? <ParkedCar rect={space.map} seed={space.id} /> : null}
            {showNumbers && !isTarget && !parked ? (
              <SvgText fontFamily={t.bold} x={c.x} y={c.y + 3} fontSize={w > 24 ? t.small : t.tiny} fill={colors.textPrimary} textAnchor="middle" opacity={state === 'closed' ? 0.5 : 0.9}>
                {glyph ?? shortLabel(space.label)}
              </SvgText>
            ) : null}
            {!showNumbers && glyph && !isTarget ? (
              <SvgText fontFamily={t.bold} x={c.x} y={c.y + 3} fontSize={t.small} fill={colors.textSupport} textAnchor="middle">
                {glyph}
              </SvgText>
            ) : null}
          </G>
        );
      })}
    </G>
  );
});

/* ----------------------------------------------------------- Chargers */

export const ChargerLayer = memo(function ChargerLayer({
  chargers,
  connectors,
  spaces,
  states,
}: {
  chargers: readonly Charger[];
  connectors: readonly Connector[];
  spaces: readonly ParkingSpace[];
  states: Readonly<Record<string, ChargerState>>;
}) {
  const { colors } = useAppTheme();
  const t = useMapText();
  const tone = (state: ChargerState | undefined) =>
    state === 'fault' ? colors.error : state === 'busy' ? colors.electricCyan : colors.success;

  return (
    <G>
      {chargers.map((c) => {
        const colour = tone(states[c.id]);
        const servedIds = [...new Set(connectors.filter((k) => k.chargerId === c.id).map((k) => k.spaceId))];
        const served = servedIds
          .map((id) => spaces.find((s) => s.id === id))
          .filter((s): s is ParkingSpace => Boolean(s));
        const { x, y } = c.map;
        return (
          <G key={c.id}>
            {/* Cables to the bays this charger reaches. */}
            {served.map((s) => (
              <Line key={s.id} x1={x} y1={y} x2={s.map.x + s.map.w / 2} y2={s.map.y + s.map.h} stroke={colour} strokeWidth={0.9} strokeDasharray="2 2" opacity={0.8} />
            ))}
            <Rect x={x - 7} y={y - 7} width={14} height={14} rx={3.5} fill={colors.mapGround} stroke={colour} strokeWidth={1.5} />
            <Polygon points={`${x + 1},${y - 5} ${x - 3},${y + 1} ${x},${y + 1} ${x - 1},${y + 5} ${x + 3},${y - 1} ${x},${y - 1}`} fill={colour} />
            <SvgText fontFamily={t.bold} x={x + 10} y={y + 3} fontSize={t.small} fill={colour}>
              {c.label.split(' ')[1]}
            </SvgText>
          </G>
        );
      })}
    </G>
  );
});

/**
 * Choosing a bay: a small bolt under each EV bay in its charger's colour
 * (green free, red out of service), instead of the chargers and their cables.
 */
export const BayChargeBadges = memo(function BayChargeBadges({
  spaces,
  connectors,
  states,
}: {
  spaces: readonly ParkingSpace[];
  connectors: readonly Connector[];
  states: Readonly<Record<string, ChargerState>>;
}) {
  const { colors } = useAppTheme();
  return (
    <G>
      {spaces.map((s) => {
        const plug = connectors.find((k) => k.spaceId === s.id);
        if (!plug) return null;
        const state = states[plug.chargerId];
        const colour = state === 'fault' ? colors.error : colors.success;
        const x = s.map.x + s.map.w / 2;
        const y = s.map.y + s.map.h + 8;
        return (
          <G key={s.id}>
            <Rect x={x - 6.5} y={y - 6.5} width={13} height={13} rx={3.5} fill={colors.mapGround} stroke={colour} strokeWidth={1.3} />
            <Polygon points={`${x + 1},${y - 4.5} ${x - 3},${y + 1} ${x},${y + 1} ${x - 1},${y + 4.5} ${x + 3},${y - 1} ${x},${y - 1}`} fill={colour} />
          </G>
        );
      })}
    </G>
  );
});

/* -------------------------------------------------------------- Gates */

export const GateLayer = memo(function GateLayer({ gates, highlightId, lang }: { gates: readonly Gate[]; highlightId?: string; lang: Lang }) {
  const { colors } = useAppTheme();
  const t = useMapText();
  const str = mapStrings(lang);
  return (
    <G>
      {gates.map((g) => {
        const isTarget = g.id === highlightId;
        const anchor = g.map.x < 40 ? 'start' : g.map.x > 320 ? 'end' : 'middle';
        const short = str.gate(g.id);
        const labelX = g.map.x + (anchor === 'start' ? 4 : anchor === 'end' ? -4 : 0);
        const labelY = g.map.y > 460 ? g.map.y - 12 : g.map.y - 16;
        const label = g.direction === 'exit' ? `${short} · ${str.exitOnly}` : short;
        const text = { fontFamily: t.bold, x: labelX, y: labelY, fontSize: t.small, textAnchor: anchor } as const;
        return (
          <G key={g.id}>
            <Circle cx={g.map.x} cy={g.map.y} r={isTarget ? 8 : 6} fill={colors.mapGate} stroke={colors.white} strokeWidth={isTarget ? 2 : 1} />
            {/* A dark outline first, so the name reads over a lit bay or the route. */}
            <SvgText {...text} fill={colors.mapGround} stroke={colors.mapGround} strokeWidth={3} strokeLinejoin="round">
              {label}
            </SvgText>
            <SvgText {...text} fill={colors.mapGate}>
              {label}
            </SvgText>
          </G>
        );
      })}
    </G>
  );
});
