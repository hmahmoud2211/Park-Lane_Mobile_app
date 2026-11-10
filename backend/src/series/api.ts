import type { BmsLatest, BmsReadingView, ComponentState, EnergyLatest, SeriesAnswer, SeriesPoint, SeriesSource } from '../../../shared/contracts/series.ts';
import type { User } from '../ems/auth.ts';
import { publishToSite, publishToUsers } from '../ems/broadcast.ts';
import { requireSite, requireSiteById, requireUnit } from '../ems/sites.ts';
import { ApiError } from '../errors.ts';
import { log } from '../log.ts';
import {
  bmsRange,
  energyRange,
  energyTotals,
  findSiteIdBySeriesKey,
  findUnitIdBySeriesKey,
  latestBms,
  latestEnergy,
  siteKeysAt,
  unitKeysAt,
  unitSeriesKey,
  type BmsRow,
  type EnergyRow,
} from '../repositories/series.ts';
import { memberIdsOfUnit } from '../repositories/units.ts';
import { cairoTime, FAULT, PUMP, SLOT_MS, slotOf } from './model.ts';

/**
 * Reading the quarter-hour series. Every query stops at the current slot, so rows written ahead (the generator
 * fills through 2029) appear one per quarter hour, by themselves. Answers say whether they are simulated.
 */

export const currentSlot = (nowMs = Date.now()) => slotOf(nowMs);
const sourceOf = (value: number): SeriesSource => (value === 1 ? 'live' : 'simulated');
const iso = (slot: number) => new Date(slot * SLOT_MS).toISOString();

/** Seconds until the next quarter hour: how long an answer can be cached. */
export const secondsToNextSlot = (nowMs = Date.now()) => Math.max(1, Math.ceil(((currentSlot(nowMs) + 1) * SLOT_MS - nowMs) / 1000));

const FAULT_LABEL: Record<number, string> = {
  [FAULT.cameraOffline]: 'A camera is offline',
  [FAULT.pumpMaintenance]: 'The booster pump is in maintenance',
  [FAULT.slowInternet]: 'The internet connection is slow',
  [FAULT.elevatorService]: 'The elevator is in its monthly service',
  [FAULT.fanService]: 'A ventilation fan is in service',
};

const pump = (pumps: number, running: number, service: number) => (pumps & service ? 'service' : pumps & running ? 'running' : 'idle') as 'running' | 'idle' | 'service';
const bit = (mask: number, index: number, onState: ComponentState): ComponentState => (mask & (1 << index) ? onState : 'normal');

export function bmsView(row: BmsRow): BmsReadingView {
  const downMbps = row.net_down_kbps / 1000;
  const checks = [
    row.fans === 0,
    row.gates === 0,
    row.cameras_online === row.cameras_total,
    !(row.pumps & PUMP.boosterMaintenance) && !(row.pumps & PUMP.liftingMaintenance),
    row.fault_code !== FAULT.slowInternet,
    row.elevator_state !== 3,
    row.fire_panel === 0,
    row.generator !== 2,
    row.fuel_pct >= 25,
    row.water_tank_pct >= 30,
    row.co2_ppm < 1200,
    row.mdb_volts >= 210 && row.mdb_volts <= 245,
  ];
  return {
    power: {
      kw: row.kw_x10 / 10,
      kwhThisQuarter: row.kwh_x10 / 10,
      solarKw: row.solar_kw_x10 / 10,
      gridCostEgp: row.grid_cost / 100,
      solarSavingEgp: row.solar_saving / 100,
    },
    mdb: { volts: row.mdb_volts, amps: row.mdb_amps_x10 / 10 },
    generator: { state: row.generator === 2 ? 'running' : 'standby', fuelPct: row.fuel_pct },
    water: {
      tankPct: row.water_tank_pct,
      flowLpm: row.water_flow_x10 / 10,
      booster: pump(row.pumps, PUMP.boosterRunning, PUMP.boosterMaintenance),
      lifting: pump(row.pumps, PUMP.liftingRunning, PUMP.liftingMaintenance),
    },
    air: { co2ppm: row.co2_ppm, temperatureC: row.temp_x10 / 10, humidityPct: row.humidity_pct },
    fans: { pressurization: bit(row.fans, 0, 'service'), jet: bit(row.fans, 1, 'service'), exhaust: bit(row.fans, 2, 'service'), freshAir: bit(row.fans, 3, 'service') },
    internet: {
      downMbps: Math.round(downMbps * 10) / 10,
      upMbps: Math.round((row.net_up_kbps / 1000) * 10) / 10,
      pingMs: row.ping_ms,
      uptimePct: row.uptime_x100 / 100,
      quality: downMbps >= 50 && row.ping_ms <= 30 ? 'excellent' : downMbps >= 15 ? 'good' : 'slow',
    },
    cameras: { online: row.cameras_online, total: row.cameras_total },
    elevator: { state: (['idle', 'up', 'down', 'service'] as const)[row.elevator_state] ?? 'idle', floor: row.elevator_floor },
    firePanel: 'normal',
    gates: { parking: bit(row.gates, 0, 'fault'), entrance: bit(row.gates, 1, 'fault'), roof: bit(row.gates, 2, 'fault') },
    fault: row.fault_code ? { code: row.fault_code, label: FAULT_LABEL[row.fault_code] ?? 'A system needs attention' } : null,
    health: Math.round((checks.filter(Boolean).length / checks.length) * 100) / 100,
    systems: checks.length,
  };
}

const kwh = (wh: number) => Math.round(wh / 10) / 100;

function siteKeyOf(user: User): number {
  requireUnit(user);
  return requireSite(user).seriesKey;
}

export function bmsLatestFor(siteKey: number, nowMs = Date.now()): BmsLatest | null {
  const row = latestBms(siteKey, currentSlot(nowMs));
  if (!row) return null;
  return { source: sourceOf(row.source), at: iso(row.slot), nextAt: iso(currentSlot(nowMs) + 1), reading: bmsView(row) };
}

export const myBmsLatest = (user: User, nowMs = Date.now()) => bmsLatestFor(siteKeyOf(user), nowMs);
export const siteBmsLatest = (siteId: string, nowMs = Date.now()) => bmsLatestFor(requireSiteById(siteId).seriesKey, nowMs);

export function myEnergyLatest(user: User, nowMs = Date.now()): EnergyLatest | null {
  const unit = requireUnit(user);
  const key = unitSeriesKey(unit.id);
  const now = currentSlot(nowMs);
  const row = latestEnergy(key, now);
  if (!row) return null;
  // Since midnight on Cairo's clock.
  const t = cairoTime(now);
  const midnight = now - Math.floor((t.hour * 60) / 15);
  const today = energyTotals(key, midnight, now);
  return {
    source: sourceOf(row.source),
    at: iso(row.slot),
    nextAt: iso(now + 1),
    quarter: { total: kwh(row.total_wh), lighting: kwh(row.lighting_wh), ac: kwh(row.ac_wh), media: kwh(row.media_wh), other: kwh(row.other_wh) },
    today: { total: kwh(today.total_wh), lighting: kwh(today.lighting_wh), ac: kwh(today.ac_wh), media: kwh(today.media_wh), other: kwh(today.other_wh) },
    kw: Math.round((row.total_wh * 4) / 10) / 100,
  };
}

// ---- ranges -------------------------------------------------------------------------------------------

const BMS_METRICS: Record<string, (row: BmsRow) => number> = {
  kw: (row) => row.kw_x10 / 10,
  kwh: (row) => row.kwh_x10 / 10,
  solar_kw: (row) => row.solar_kw_x10 / 10,
  grid_cost: (row) => row.grid_cost / 100,
  co2: (row) => row.co2_ppm,
  temp: (row) => row.temp_x10 / 10,
  humidity: (row) => row.humidity_pct,
  net_down: (row) => row.net_down_kbps / 1000,
  ping: (row) => row.ping_ms,
  water_tank: (row) => row.water_tank_pct,
};
const ENERGY_METRICS: Record<string, (row: EnergyRow) => number> = {
  total: (row) => row.total_wh / 1000,
  lighting: (row) => row.lighting_wh / 1000,
  ac: (row) => row.ac_wh / 1000,
  media: (row) => row.media_wh / 1000,
  other: (row) => row.other_wh / 1000,
};
const BUCKET_SLOTS = { '15m': 1, '1h': 4, '1d': 96 } as const;
const MAX_POINTS = 2000;

interface RangeQuery<R> {
  metrics: Record<string, (row: R) => number>;
  load: (from: number, to: number) => R[];
}

function range<R extends { slot: number; source: number }>(query: URLSearchParams, spec: RangeQuery<R>, nowMs: number): SeriesAnswer {
  const bucket = (query.get('bucket') ?? '1h') as keyof typeof BUCKET_SLOTS;
  if (!(bucket in BUCKET_SLOTS)) throw new ApiError('invalid', 'Use bucket 15m, 1h or 1d.', 'bucket');
  const names = (query.get('metrics') ?? Object.keys(spec.metrics).slice(0, 2).join(',')).split(',').map((name) => name.trim()).filter(Boolean);
  if (names.length === 0 || names.some((name) => !(name in spec.metrics))) throw new ApiError('invalid', `Choose from: ${Object.keys(spec.metrics).join(', ')}.`, 'metrics');
  const now = currentSlot(nowMs);
  const toMs = query.get('to') ? Date.parse(query.get('to')!) : nowMs;
  const fromMs = query.get('from') ? Date.parse(query.get('from')!) : toMs - 86_400_000;
  if (Number.isNaN(fromMs) || Number.isNaN(toMs) || fromMs > toMs) throw new ApiError('invalid', 'Give from and to as times, from before to.', 'from');
  const to = Math.min(now, slotOf(toMs));
  const from = slotOf(fromMs);
  if ((to - from + 1) / BUCKET_SLOTS[bucket] > MAX_POINTS) throw new ApiError('invalid', `That is more than ${MAX_POINTS} points; use a larger bucket or a shorter range.`, 'bucket');
  const rows = to >= from ? spec.load(from, to) : [];
  const groups = new Map<number, R[]>();
  for (const row of rows) {
    // Days follow Cairo's calendar; hours and quarters follow the slot.
    const key = bucket === '1d' ? row.slot - Math.floor((cairoTime(row.slot).hour * 60) / 15) : row.slot - (row.slot % BUCKET_SLOTS[bucket]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const points: SeriesPoint[] = [...groups.entries()].map(([key, group]) => {
    const point: SeriesPoint = { at: iso(key), avg: {}, min: {}, max: {} };
    for (const name of names) {
      const values = group.map(spec.metrics[name]);
      point.avg[name] = Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100;
      point.min[name] = Math.min(...values);
      point.max[name] = Math.max(...values);
    }
    return point;
  });
  return { source: rows.some((row) => row.source === 1) ? 'live' : 'simulated', bucket, metrics: names, points };
}

export function myBmsSeries(user: User, query: URLSearchParams, nowMs = Date.now()): SeriesAnswer {
  const key = siteKeyOf(user);
  return range(query, { metrics: BMS_METRICS, load: (from, to) => bmsRange(key, from, to) }, nowMs);
}

export function myEnergySeries(user: User, query: URLSearchParams, nowMs = Date.now()): SeriesAnswer {
  const key = unitSeriesKey(requireUnit(user).id);
  return range(query, { metrics: ENERGY_METRICS, load: (from, to) => energyRange(key, from, to) }, nowMs);
}

// ---- the quarter-hour push ----------------------------------------------------------------------------

/** Tells the residents of each compound, and the members of each apartment, whose new reading just became current. */
export function announceSlot(slot: number): { sites: number; units: number } {
  const at = iso(slot);
  const sites = siteKeysAt(slot);
  for (const key of sites) {
    const siteId = findSiteIdBySeriesKey(key);
    if (siteId) publishToSite(siteId, { type: 'bms.reading', at });
  }
  const units = unitKeysAt(slot);
  for (const key of units) {
    const unitId = findUnitIdBySeriesKey(key);
    if (unitId) publishToUsers(memberIdsOfUnit(unitId), { type: 'energy.reading', at });
  }
  return { sites: sites.length, units: units.length };
}

/** A timer aligned to each quarter hour (re-aligned every tick, so it never drifts). */
export function startQuarterHourPush(): () => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const schedule = () => {
    const now = Date.now();
    timer = setTimeout(() => {
      try {
        announceSlot(currentSlot());
      } catch (error) {
        log.error('Quarter-hour push failed', { reason: (error as Error).message });
      }
      schedule();
    }, (currentSlot(now) + 1) * SLOT_MS - now + 1500);
    timer.unref?.();
  };
  schedule();
  return () => {
    if (timer) clearTimeout(timer);
  };
}
