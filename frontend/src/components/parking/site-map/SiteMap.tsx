import Ionicons from '@expo/vector-icons/Ionicons';
import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  PanResponder,
  Platform,
  Pressable,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import Svg, { G } from 'react-native-svg';

import { useAppTheme } from '../../../hooks/useAppTheme';
import { useReduceMotion } from '../../../hooks/useReduceMotion';
import type { Lang } from '../../../services/parking/i18n';
import { stepText } from '../../../services/parking/i18n';
import { MAP_SIZE, ramps } from '../../../services/parking/site';
import type { LevelId, MapPoint, ParkingDb, ParkingSpace } from '../../../services/parking/types';
import type { AppTheme } from '../../../types/theme.types';
import { AppIcon } from '../../common/AppIcon';
import { AppText } from '../../common/AppText';
import { DirectionView } from '../../common/DirectionView';
import { Segmented } from '../Controls';
import { NeonPanel } from '../../ui/NeonPanel';
import {
  BayChargeBadges,
  BayLayer,
  ChargerLayer,
  GateLayer,
  LevelPlan,
  ZoneLayer,
  type ZoneOutline,
} from './MapLayers';
import {
  allSteps,
  boundsOf,
  chargerState,
  levelsFor,
  liveBayState,
  rectCentre,
  type BayState,
  type ChargerState,
} from './mapModel';
import { mapStrings } from './mapStrings';
import { RouteLayer } from './RouteLayer';

export type BayMark = 'free' | 'taken';

/**
 * `directions` guides a driver along a bay's route, step by step.
 * `select` colours bays by availability for a chosen time and lets a free
 * one be picked. `browse` shows live status around a highlighted bay.
 */
export type SiteMapMode = 'directions' | 'select' | 'browse';

export interface SiteMapProps {
  db: ParkingDb;
  now: number;
  mode: SiteMapMode;
  /** The bay being found (directions), chosen (select) or highlighted (browse). */
  targetSpaceId?: string;
  /**
   * For a visitor's page: other bays are drawn without numbers or status,
   * and levels off the visitor's route are not offered.
   */
  privacy?: boolean;
  /** Select: availability of each bay for the chosen time, and why some are not free. */
  marks?: Readonly<Record<string, BayMark>>;
  reasons?: Readonly<Record<string, string>>;
  onSelectSpace?: (spaceId: string) => void;
  /** Arabic on a guest's pass; English everywhere else. */
  lang?: Lang;
  /** Sets the drawing in its own neon card, for a page that shows the map without a panel around it. */
  framed?: boolean;
  style?: StyleProp<ViewStyle>;
}

const W = MAP_SIZE.width;
const H = MAP_SIZE.height;
const ZOOMS = [1, 1.6, 2.4, 3.2] as const;

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

type Picked = { kind: 'bay' | 'charger'; id: string } | null;

/**
 * The compound's internal map: three levels, roads and aisles, buildings,
 * gates, zones, bays and chargers, with the route to a bay drawn on top.
 * It guides with landmarks and level changes; it never claims a live GPS
 * position, which basements cannot provide.
 */
export function SiteMap({
  db,
  now,
  mode,
  targetSpaceId,
  privacy = false,
  marks,
  reasons,
  onSelectSpace,
  lang = 'en',
  framed = false,
  style,
}: SiteMapProps) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  const still = useReduceMotion();
  const str = mapStrings(lang);

  const target = db.spaces.find((s) => s.id === targetSpaceId);
  const route = target?.route;
  const steps = allSteps(route);
  /* ------------------------------------------------------------ Levels */

  const markedLevels = marks ? [...new Set(db.spaces.filter((s) => marks[s.id]).map((s) => s.levelId))] : [];
  const levelOptions = levelsFor({
    privacy,
    routeLevels: [...new Set(steps.map((s) => s.levelId))],
    extra: markedLevels,
  });
  // Directions open where the route starts (the gate); choosing a bay opens on the bay's level.
  const defaultLevel: LevelId =
    (mode === 'directions' ? steps[0]?.levelId : undefined) ?? target?.levelId ?? markedLevels[0] ?? 'ground';
  // A tab the user picked holds until the bay changes.
  const [levelChoice, setLevelChoice] = useState<{ target?: string; level: LevelId } | null>(null);
  const level = levelChoice && levelChoice.target === targetSpaceId ? levelChoice.level : defaultLevel;
  const chooseLevel = (next: LevelId) => setLevelChoice({ target: targetSpaceId, level: next });

  /* ---------------------------------------------------------- Viewport */

  const [width, setWidth] = useState(0);
  const onLayout = (e: LayoutChangeEvent) => setWidth(e.nativeEvent.layout.width);
  const [zoom, setZoom] = useState<number>(1);

  const focus: MapPoint = target && target.levelId === level ? rectCentre(target.map) : { x: W / 2, y: H / 2 };
  const viewKey = `${level}|${targetSpaceId ?? ''}`;
  const [pan, setPan] = useState<{ key: string; x: number; y: number } | null>(null);
  const centre = pan && pan.key === viewKey ? pan : focus;
  const vbW = W / zoom;
  const vbH = H / zoom;
  const cx = clamp(centre.x, vbW / 2, W - vbW / 2);
  const cy = clamp(centre.y, vbH / 2, H - vbH / 2);
  const vb = { x: cx - vbW / 2, y: cy - vbH / 2 };
  const scale = width > 0 ? width / vbW : 0;

  // Dragging pans the map once zoomed in. The panner is created once and is
  // told the current view after each render, so a drag never restarts mid-way.
  const [panner] = useState(() => new MapPanner(setPan));
  useEffect(() => {
    panner.sync({ zoom, cx, cy, scale, vbW, vbH, key: viewKey });
  });

  const zoomBy = (direction: 1 | -1) => {
    const index = ZOOMS.findIndex((z) => z >= zoom);
    setZoom(ZOOMS[clamp(index + direction, 0, ZOOMS.length - 1)]);
  };

  /* ------------------------------------------------------- Map content */

  const [showWalk, setShowWalk] = useState(true);
  const [showNumbers, setShowNumbers] = useState(!privacy);
  const [picked, setPicked] = useState<Picked>(null);

  const levelSpaces = db.spaces.filter((s) => s.levelId === level);
  const levelChargers = db.chargers.filter((c) => c.map.levelId === level);
  const zoneCounts = db.zones.map((zone) => {
    const spaces = db.spaces.filter((s) => s.zoneId === zone.id);
    return { zone, spaces, free: spaces.filter((s) => liveBayState(db, s, now) === 'free').length };
  });

  /* -------------------------------------------------------------- Taps */

  const toScreen = (r: { x: number; y: number; w: number; h: number }) => ({
    position: 'absolute' as const,
    left: (r.x - vb.x) * scale,
    top: (r.y - vb.y) * scale,
    width: r.w * scale,
    height: r.h * scale,
  });

  const tapBay = (id: string) => {
    if (mode === 'select' && marks?.[id] === 'free') {
      onSelectSpace?.(id);
      setPicked(null);
      return;
    }
    setPicked({ kind: 'bay', id });
  };

  const tappableBays = levelSpaces.filter((s) => !privacy || s.id === targetSpaceId);
  const rampTargets =
    level === 'ground'
      ? ramps
          .filter((r) => levelOptions.some((l) => l.id === r.toLevel))
          .map((r) => ({ id: r.id, rect: r.ground, to: r.toLevel }))
      : ramps
          .filter((r) => r.toLevel === level)
          .map((r) => ({ id: r.id, rect: r.landing, to: 'ground' as LevelId }));

  /* ------------------------------------------------------------ Legend */

  const legend: { key: string; color: string; label: string; shape?: 'line' | 'dot' | 'box' | 'outline' }[] = [];
  const L = str.legend;
  if (mode === 'select') {
    // Choosing a bay: what each bay looks like, as in the drawing.
    legend.push({ key: 'free', color: theme.colors.mapBayFreeStroke, label: L.available, shape: 'outline' });
    legend.push({ key: 'occ', color: theme.colors.mapBayTakenStroke, label: L.occupiedNow, shape: 'outline' });
    legend.push({ key: 'res', color: theme.colors.mapBayReservedStroke, label: L.reserved, shape: 'outline' });
    if (target) legend.push({ key: 'you', color: theme.colors.mapTarget, label: L.selected, shape: 'box' });
    if (route) legend.push({ key: 'route', color: theme.colors.mapRoute, label: L.route, shape: 'dot' });
  } else {
    if (route) legend.push({ key: 'route', color: theme.colors.mapRoute, label: L.route, shape: 'dot' });
    if (target) legend.push({ key: 'you', color: theme.colors.mapTarget, label: L.yourBay, shape: 'box' });
    if (route?.walk && showWalk)
      legend.push({ key: 'walk', color: theme.colors.mapWalk, label: L.walk, shape: 'dot' });
    if (level === 'ground')
      legend.push({ key: 'gate', color: theme.colors.mapGate, label: L.gate, shape: 'dot' });
    if (!privacy) {
      legend.push({ key: 'free', color: theme.colors.mapBayFreeStroke, label: L.freeNow, shape: 'outline' });
      legend.push({ key: 'occ', color: theme.colors.mapBayTakenStroke, label: L.occupied, shape: 'outline' });
      legend.push({ key: 'res', color: theme.colors.mapBayReservedStroke, label: L.reserved, shape: 'outline' });
    }
    if (levelChargers.length) {
      legend.push({ key: 'c-ok', color: theme.colors.success, label: L.chargerFree, shape: 'dot' });
      legend.push({ key: 'c-busy', color: theme.colors.electricCyan, label: L.inUse, shape: 'dot' });
      legend.push({ key: 'c-fault', color: theme.colors.error, label: L.fault, shape: 'dot' });
    }
  }

  /* ---------------------------------------------------------- Info card */

  const pickedBay = picked?.kind === 'bay' ? db.spaces.find((s) => s.id === picked.id) : undefined;
  const pickedCharger = picked?.kind === 'charger' ? db.chargers.find((c) => c.id === picked.id) : undefined;
  const info = (() => {
    if (pickedBay) {
      const zone = db.zones.find((z) => z.id === pickedBay.zoneId);
      const plug = db.connectors.filter((k) => k.spaceId === pickedBay.id);
      const charger = db.chargers.find((c) => c.id === plug[0]?.chargerId);
      const status =
        pickedBay.id === targetSpaceId && mode !== 'select'
          ? str.yourBay
          : mode === 'select'
            ? marks?.[pickedBay.id] === 'free'
              ? str.freeForVisit
              : (reasons?.[pickedBay.id] ?? str.bayState.taken)
            : str.bayState[liveBayState(db, pickedBay, now)];
      return {
        title: pickedBay.label,
        lines: [
          `${str.name(zone?.name ?? '')} · ${str.name(zone?.level ?? '')}`,
          status,
          charger ? `${charger.label} · ${plug.map((k) => k.type).join(', ')}` : '',
        ].filter(Boolean),
      };
    }
    if (pickedCharger) {
      const plugs = db.connectors
        .filter((k) => k.chargerId === pickedCharger.id)
        .map((k) => `${k.type} → ${db.spaces.find((s) => s.id === k.spaceId)?.label}`);
      return {
        title: pickedCharger.label,
        lines: [
          plugs.join(' · '),
          str.chargesAtOnce(pickedCharger.maxConcurrent),
          str.chargerState[chargerState(db, pickedCharger, now)],
        ],
      };
    }
    return null;
  })();

  const summary =
    target && route
      ? `${str.mapOf(str.level(level))}. ${steps.map((st) => stepText(st, lang)).join('. ')}`
      : str.mapOf(str.level(level));

  return (
    <View style={style}>
      {levelOptions.length > 1 ? (
        <Segmented
          options={levelOptions.map((l) => ({ value: l.id, label: str.levelShort(l.id) }))}
          value={level}
          onChange={chooseLevel}
          style={styles.tabs}
        />
      ) : null}

      <CanvasFrame
        framed={framed}
        title={str.level(level)}
        overline={
          mode === 'select' && marks
            ? levelSpaces.some((s) => marks[s.id])
              ? str.availableSpots(levelSpaces.filter((s) => marks[s.id] === 'free').length)
              : str.notBookable
            : privacy
              ? undefined
              : str.availableSpots(levelSpaces.filter((s) => liveBayState(db, s, now) === 'free').length)
        }
      >
        <DirectionView
          // The drawing has its own coordinates: it stays left-to-right inside an Arabic page.
          direction={lang === 'ar' ? 'ltr' : undefined}
          style={[
            styles.canvas,
            { height: width ? (width * H) / W : undefined },
            webNoSelect,
            zoom > 1 && webNoScroll,
          ]}
          onLayout={onLayout}
          {...panner.handlers}
        >
          {width > 0 ? (
            <Svg
              width={width}
              height={(width * H) / W}
              viewBox={`${vb.x} ${vb.y} ${vbW} ${vbH}`}
              accessibilityLabel={summary}
            >
              <MapDrawing
                db={db}
                now={now}
                level={level}
                mode={mode}
                privacy={privacy}
                marks={marks}
                targetSpaceId={targetSpaceId}
                showWalk={showWalk}
                showNumbers={showNumbers && !privacy}
                still={still}
                lang={lang}
                framed={framed}
              />
            </Svg>
          ) : null}

          {/* Tap targets: plain views over the drawing, so they work and read the same everywhere. */}
          {scale > 0
            ? tappableBays.map((s) => (
                <Pressable
                  key={s.id}
                  onPress={() => tapBay(s.id)}
                  hitSlop={2}
                  accessibilityRole="button"
                  accessibilityLabel={
                    mode === 'select'
                      ? str.chooseBay(s.label, marks?.[s.id] === 'free')
                      : str.bayDetails(s.label)
                  }
                  accessibilityState={{ selected: s.id === targetSpaceId }}
                  style={toScreen(s.map)}
                />
              ))
            : null}
          {scale > 0 && mode !== 'select'
            ? levelChargers.map((c) => (
                <Pressable
                  key={c.id}
                  onPress={() => setPicked({ kind: 'charger', id: c.id })}
                  accessibilityRole="button"
                  accessibilityLabel={str.chargerDetails(c.label)}
                  style={toScreen({ x: c.map.x - 9, y: c.map.y - 9, w: 18, h: 18 })}
                />
              ))
            : null}
          {scale > 0
            ? rampTargets.map((r) => (
                <Pressable
                  key={r.id}
                  onPress={() => chooseLevel(r.to)}
                  accessibilityRole="button"
                  accessibilityLabel={str.goTo(str.level(r.to))}
                  style={toScreen(r.rect)}
                />
              ))
            : null}

          <View style={styles.zoom}>
            <MapButton
              icon="add"
              label={str.zoomIn}
              onPress={() => zoomBy(1)}
              disabled={zoom >= ZOOMS[ZOOMS.length - 1]}
            />
            <MapButton icon="remove" label={str.zoomOut} onPress={() => zoomBy(-1)} disabled={zoom <= 1} />
            <MapButton
              icon="scan-outline"
              label={str.fit}
              onPress={() => {
                setZoom(1);
                setPan(null);
              }}
              disabled={zoom <= 1}
            />
          </View>
          {zoom > 1 ? (
            <View style={styles.hint} pointerEvents="none">
              <AppText variant="label" color={theme.colors.textSupport}>
                {str.dragHint}
              </AppText>
            </View>
          ) : null}
        </DirectionView>
      </CanvasFrame>

      <View style={styles.toggles}>
        {route?.walk ? (
          <Toggle label={str.walkingRoute} on={showWalk} onPress={() => setShowWalk((v) => !v)} />
        ) : null}
        {!privacy ? (
          <Toggle label={str.bayNumbers} on={showNumbers} onPress={() => setShowNumbers((v) => !v)} />
        ) : null}
      </View>

      <View style={styles.legend}>
        {legend.map((item) => (
          <View key={item.key} style={styles.legendItem}>
            <View
              style={[
                item.shape === 'line'
                  ? styles.swatchLine
                  : item.shape === 'dot'
                    ? styles.swatchDot
                    : styles.swatchBox,
                item.shape === 'outline' ? { borderWidth: 1.5, borderColor: item.color } : { backgroundColor: item.color },
              ]}
            />
            <AppText variant="label" color={theme.colors.textSupport}>
              {item.label}
            </AppText>
          </View>
        ))}
      </View>

      {info ? (
        <View style={styles.info} accessibilityLiveRegion="polite">
          <View style={styles.infoText}>
            <AppText variant="bodyStrong">{info.title}</AppText>
            {info.lines.map((line) => (
              <AppText key={line} variant="label" color={theme.colors.textSupport}>
                {line}
              </AppText>
            ))}
          </View>
          <Pressable
            onPress={() => setPicked(null)}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={str.close}
          >
            <Ionicons name="close" size={18} color={theme.colors.textSupport} />
          </Pressable>
        </View>
      ) : null}

      {!privacy && mode !== 'select' ? (
        <View style={styles.zones}>
          {zoneCounts.map(({ zone, spaces, free }) => (
            <Pressable
              key={zone.id}
              onPress={() => {
                chooseLevel(zone.levelId);
                setZoom(ZOOMS[1]);
                const rect = boundsOf(spaces.map((s) => s.map));
                setPan({
                  key: `${zone.levelId}|${targetSpaceId ?? ''}`,
                  ...rectCentre(rect),
                });
              }}
              accessibilityRole="button"
              accessibilityLabel={`${str.name(zone.name)}, ${str.name(zone.level)}, ${str.free(free, spaces.length)}`}
              style={({ pressed }) => [styles.zoneChip, pressed && styles.pressed]}
            >
              <AppIcon
                set="material"
                name={
                  zone.kind === 'ev' ? 'ev-station' : zone.kind === 'resident' ? 'home-outline' : 'parking'
                }
                size={15}
                color={theme.colors.textPrimary}
              />
              <View>
                <AppText variant="label">{str.name(zone.name)}</AppText>
                <AppText variant="label" color={theme.colors.textSupport}>
                  {`${str.name(zone.level)} · ${str.free(free, spaces.length)}`}
                </AppText>
              </View>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

interface MapDrawingProps {
  db: ParkingDb;
  now: number;
  level: LevelId;
  mode: SiteMapMode;
  privacy: boolean;
  marks?: Readonly<Record<string, BayMark>>;
  targetSpaceId?: string;
  showWalk: boolean;
  showNumbers: boolean;
  still: boolean;
  lang: Lang;
  framed: boolean;
}

/**
 * Everything drawn inside the map. Memoised on its inputs, which do not
 * change while the map is dragged, so panning only moves the viewBox.
 */
const MapDrawing = memo(function MapDrawing({
  db,
  now,
  level,
  mode,
  privacy,
  marks,
  targetSpaceId,
  showWalk,
  showNumbers,
  still,
  lang,
  framed,
}: MapDrawingProps) {
  const str = mapStrings(lang);
  const target = db.spaces.find((s) => s.id === targetSpaceId);
  const route = target?.route;
  const gate = db.gates.find((g) => g.id === target?.gateId);
  const levelSpaces = db.spaces.filter((s) => s.levelId === level);
  const levelChargers = db.chargers.filter((c) => c.map.levelId === level);

  const states: Record<string, BayState> = {};
  for (const s of levelSpaces) {
    const live = liveBayState(db, s, now);
    // Choosing a bay: free for the whole visit, or not; a bay that is not free shows a car if one is in it now.
    states[s.id] = privacy
      ? 'neutral'
      : mode === 'select' && marks
        ? marks[s.id] === 'free'
          ? 'free'
          : marks[s.id] === 'taken'
            ? live === 'occupied' || live === 'closed' || live === 'unknown'
              ? live
              : 'reserved'
            : live === 'occupied'
              ? 'occupied'
              : 'neutral'
        : live;
  }
  const chargerStates: Record<string, ChargerState> = {};
  for (const c of levelChargers) chargerStates[c.id] = chargerState(db, c, now);

  const freeIn = (spaces: ParkingSpace[]) => spaces.filter((s) => liveBayState(db, s, now) === 'free').length;
  const zones: ZoneOutline[] = db.zones
    .filter((z) => z.levelId === level)
    .map((zone) => {
      const spaces = db.spaces.filter((s) => s.zoneId === zone.id);
      const rect = boundsOf(
        spaces.map((s) => s.map),
        4,
      );
      return {
        id: zone.id,
        rect,
        label: privacy
          ? str.name(zone.name)
          : `${str.name(zone.name)} · ${str.free(freeIn(spaces), spaces.length)}`,
        // Choosing a bay, the colours already say what is free; the names only crowd the plan.
        labelAt: level === 'ground' && mode !== 'select' ? { x: rect.x, y: 203 } : undefined,
      };
    });
  const basementZone = level === 'ground' || privacy ? undefined : db.zones.find((z) => z.levelId === level);
  const basementSpaces = basementZone ? db.spaces.filter((s) => s.zoneId === basementZone.id) : [];
  const ev = basementZone?.kind === 'ev';
  const summary = !basementZone
    ? undefined
    : mode === 'select' && marks && !basementSpaces.some((s) => marks[s.id])
      ? str.notBookable
      : mode === 'select' && marks
        ? str.freeForYourTime(
            basementSpaces.filter((s) => marks[s.id] === 'free').length,
            basementSpaces.length,
            ev,
          )
        : str.basementSummary(freeIn(basementSpaces), basementSpaces.length, ev);

  const ramp = ramps.find((r) => r.toLevel === target?.levelId);

  return (
    <G>
      <LevelPlan levelId={level} buildings={db.buildings} summary={summary} titled={!framed} lang={lang} />
      <ZoneLayer zones={zones} />
      <BayLayer spaces={levelSpaces} states={states} targetId={targetSpaceId} showNumbers={showNumbers} />
      {levelChargers.length && mode === 'select' ? (
        <BayChargeBadges spaces={levelSpaces} connectors={db.connectors} states={chargerStates} />
      ) : levelChargers.length ? (
        <ChargerLayer
          chargers={levelChargers}
          connectors={db.connectors}
          spaces={levelSpaces}
          states={chargerStates}
        />
      ) : null}
      {target && route ? (
        <RouteLayer
          levelId={level}
          steps={allSteps(route)}
          showWalk={showWalk}
          gate={gate?.map}
          destination={{ point: rectCentre(target.map), label: target.label, levelId: target.levelId }}
          arrival={
            ramp
              ? ramp.landing.x < W / 2
                ? {
                    point: { x: ramp.landing.x + ramp.landing.w, y: ramp.landing.y + 14 },
                    levelId: ramp.toLevel,
                    side: 'right',
                  }
                : {
                    point: { x: ramp.landing.x, y: ramp.landing.y + 14 },
                    levelId: ramp.toLevel,
                    side: 'left',
                  }
              : undefined
          }
          still={still}
          lang={lang}
          callouts={mode !== 'select'}
        />
      ) : null}
      {/* Last, so a highlighted bay beside a gate never hides the gate's name. */}
      {level === 'ground' ? <GateLayer gates={db.gates} highlightId={gate?.id} lang={lang} /> : null}
    </G>
  );
});

type PanView = { zoom: number; cx: number; cy: number; scale: number; vbW: number; vbH: number; key: string };

/**
 * Turns drags into map panning once zoomed in. One instance lives for the
 * map's lifetime; `sync` gives it the current view after each render.
 */
class MapPanner {
  private view: PanView = { zoom: 1, cx: W / 2, cy: H / 2, scale: 0, vbW: W, vbH: H, key: '' };
  private start: MapPoint = { x: 0, y: 0 };
  readonly handlers;

  constructor(onPan: (pan: { key: string; x: number; y: number }) => void) {
    this.handlers = PanResponder.create({
      onMoveShouldSetPanResponderCapture: (_e, g) => this.view.zoom > 1 && Math.hypot(g.dx, g.dy) > 6,
      onPanResponderGrant: () => {
        this.start = { x: this.view.cx, y: this.view.cy };
      },
      onPanResponderMove: (_e, g) => {
        const v = this.view;
        if (!v.scale) return;
        onPan({
          key: v.key,
          x: clamp(this.start.x - g.dx / v.scale, v.vbW / 2, W - v.vbW / 2),
          y: clamp(this.start.y - g.dy / v.scale, v.vbH / 2, H - v.vbH / 2),
        });
      },
      onPanResponderTerminationRequest: () => false,
    }).panHandlers;
  }

  sync(view: PanView) {
    this.view = view;
  }
}

/**
 * Web only: dragging never selects the map's text, and a zoomed map takes
 * drags for panning instead of scrolling the page. These are CSS properties
 * React Native's style types do not list.
 */
const webNoSelect = (Platform.OS === 'web' ? { userSelect: 'none' } : {}) as unknown as ViewStyle;
const webNoScroll = (Platform.OS === 'web' ? { touchAction: 'none' } : {}) as unknown as ViewStyle;

/** The drawing's own neon card, headed by the level and how many spots are free, when the page has no panel around the map. */
function CanvasFrame({ framed, title, overline, children }: { framed: boolean; title: string; overline?: string; children: ReactNode }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  if (!framed) return <>{children}</>;
  return (
    <NeonPanel>
      <View style={styles.frame}>
        <View style={styles.frameHead}>
          <AppText variant="subheading">{title}</AppText>
          {overline ? (
            <AppText variant="overline" color={theme.colors.textSupport}>
              {overline}
            </AppText>
          ) : null}
        </View>
        {children}
      </View>
    </NeonPanel>
  );
}

function MapButton({
  icon,
  label,
  onPress,
  disabled,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.mapButton, pressed && styles.pressed, disabled && styles.disabled]}
    >
      <Ionicons name={icon} size={18} color={theme.colors.textPrimary} />
    </Pressable>
  );
}

function Toggle({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const theme = useAppTheme();
  const styles = useMemo(() => createStyles(theme), [theme]);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.toggle, on && styles.toggleOn, pressed && styles.pressed]}
    >
      <Ionicons
        name={on ? 'eye-outline' : 'eye-off-outline'}
        size={14}
        color={on ? theme.colors.textPrimary : theme.colors.textSupport}
      />
      <AppText variant="label" color={on ? theme.colors.textPrimary : theme.colors.textSupport}>
        {label}
      </AppText>
    </Pressable>
  );
}

function createStyles(theme: AppTheme) {
  return StyleSheet.create({
    tabs: {
      marginBottom: 10,
    },
    frame: {
      padding: 8,
    },
    frameHead: {
      paddingHorizontal: 6,
      paddingTop: 4,
      paddingBottom: 8,
      gap: 2,
    },
    canvas: {
      width: '100%',
      aspectRatio: W / H,
      borderRadius: theme.borderRadius.md,
      overflow: 'hidden',
    },
    zoom: {
      position: 'absolute',
      right: 8,
      bottom: 8,
      gap: 6,
    },
    mapButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: theme.colors.cameraFill,
      borderWidth: 1,
      borderColor: theme.colors.dividerSubtle,
    },
    hint: {
      position: 'absolute',
      left: 8,
      bottom: 8,
      paddingHorizontal: 8,
      paddingVertical: 4,
      borderRadius: theme.borderRadius.pill,
      backgroundColor: theme.colors.cameraFill,
    },
    toggles: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 10,
    },
    toggle: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: theme.borderRadius.pill,
      borderWidth: 1,
      borderColor: theme.colors.dividerSubtle,
      backgroundColor: theme.colors.fieldFill,
    },
    toggleOn: {
      borderColor: theme.colors.infoStroke,
      backgroundColor: theme.colors.infoFill,
    },
    legend: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      columnGap: 14,
      rowGap: 6,
      marginTop: 10,
    },
    legendItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    swatchBox: {
      width: 12,
      height: 12,
      borderRadius: 3,
    },
    swatchDot: {
      width: 10,
      height: 10,
      borderRadius: 5,
    },
    swatchLine: {
      width: 16,
      height: 3,
      borderRadius: 2,
    },
    info: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 10,
      marginTop: 10,
      padding: 12,
      borderRadius: theme.borderRadius.md,
      borderWidth: 1,
      borderColor: theme.colors.infoStroke,
      backgroundColor: theme.colors.infoFill,
    },
    infoText: {
      flex: 1,
      gap: 2,
    },
    zones: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 12,
    },
    zoneChip: {
      flexGrow: 1,
      flexBasis: '45%',
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      padding: 10,
      borderRadius: theme.borderRadius.sm,
      borderWidth: 1,
      borderColor: theme.colors.dividerSubtle,
      backgroundColor: theme.colors.fieldFill,
    },
    pressed: {
      opacity: 0.7,
    },
    disabled: {
      opacity: 0.4,
    },
  });
}
