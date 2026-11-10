/**
 * The simulated building and apartments, one quarter hour at a time. Every value is a pure function of
 * (seed, series key, slot), from a counter-based random generator, so any slot can be computed on its own: the
 * generator can resume anywhere and re-running it writes the same rows.
 *
 * Models for Cairo (30.0° N, 31.2° E): occupancy by hour (weekend Friday and Saturday), monthly temperature normals
 * driving air conditioning, solar output from the sun's height on clear days, a daily water-tank cycle, CO₂ after
 * occupancy, internet slowing in the evening, an elevator moving between floors, and small noise everywhere.
 * Faults are rare and never about safety: a camera offline, a pump or fan in maintenance, a slow connection, the
 * elevator's monthly service. The fire panel always reads normal: nothing simulated is ever an alarm.
 */

export const SLOT_MS = 15 * 60_000;
export const slotOf = (ms: number) => Math.floor(ms / SLOT_MS);

/** A 32-bit hash of integers (Murmur3 finaliser over a combination), as a number in [0, 1). */
export function noise(seed: number, key: number, slot: number, stream: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(key + 0x632be59b, 0xc2b2ae35);
  h ^= Math.imul(slot ^ (slot / 0x100000000), 0x27d4eb2f);
  h ^= Math.imul(stream + 0x165667b1, 0x9e3779b1);
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}

/** Noise centred on 0, roughly in [-1, 1]. */
const wobble = (seed: number, key: number, slot: number, stream: number) => noise(seed, key, slot, stream) + noise(seed, key, slot, stream + 977) - 1;

// ---- Cairo's clock -----------------------------------------------------------------------------------

const offsetCache = new Map<number, number>();

/** Cairo's UTC offset in minutes on that UTC day (Egypt keeps summer time from late April to late October). */
function cairoOffsetMinutes(ms: number): number {
  const day = Math.floor(ms / 86_400_000);
  const cached = offsetCache.get(day);
  if (cached !== undefined) return cached;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone: 'Africa/Cairo', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(day * 86_400_000 + 12 * 3600_000))
      .map((part) => [part.type, part.value]),
  );
  const local = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute));
  const offset = Math.round((local - (day * 86_400_000 + 12 * 3600_000)) / 60_000);
  offsetCache.set(day, offset);
  return offset;
}

export interface LocalTime {
  year: number;
  /** Hours since local midnight, 0-24 with fractions. */
  hour: number;
  /** 0 Sunday … 6 Saturday. */
  weekday: number;
  month: number;
  dayOfMonth: number;
  dayOfYear: number;
}

export function cairoTime(slot: number): LocalTime {
  const ms = slot * SLOT_MS;
  const local = new Date(ms + cairoOffsetMinutes(ms) * 60_000);
  const start = Date.UTC(local.getUTCFullYear(), 0, 1);
  return {
    year: local.getUTCFullYear(),
    hour: local.getUTCHours() + local.getUTCMinutes() / 60,
    weekday: local.getUTCDay(),
    month: local.getUTCMonth(),
    dayOfMonth: local.getUTCDate(),
    dayOfYear: Math.floor((local.getTime() - start) / 86_400_000) + 1,
  };
}

// ---- shared shapes -----------------------------------------------------------------------------------

/** Share of residents at home and active, 0-1. Friday and Saturday are the weekend. */
export function occupancy(t: LocalTime): number {
  const h = t.hour;
  const weekend = t.weekday === 5 || t.weekday === 6;
  const bump = (centre: number, width: number, height: number) => height * Math.exp(-(((h - centre) / width) ** 2));
  const base = weekend ? 0.45 + bump(13, 4, 0.25) + bump(21, 2.5, 0.3) : 0.3 + bump(7.5, 1.2, 0.35) + bump(20.5, 2.5, 0.55);
  const night = h < 6 ? 0.15 : 0;
  return Math.min(1, Math.max(0.1, base - night));
}

/** Cairo's mean daily temperature by month (°C), with the day's swing: coolest near dawn, warmest mid-afternoon. */
const MONTHLY_MEAN = [14.5, 15.8, 18.4, 22.0, 25.6, 27.8, 28.8, 28.7, 27.0, 24.1, 19.8, 15.9];
export function outdoorTemperature(t: LocalTime, jitter: number): number {
  const swing = t.month >= 4 && t.month <= 8 ? 7 : 5.5;
  return MONTHLY_MEAN[t.month] + swing * Math.cos(((t.hour - 15) / 24) * 2 * Math.PI) + jitter * 1.2;
}

/** The sun's height above the horizon (radians) in Cairo, from the day of the year and the solar time. */
export function sunElevation(slot: number, t: LocalTime): number {
  const latitude = (30.04 * Math.PI) / 180;
  const declination = ((23.44 * Math.PI) / 180) * Math.sin((2 * Math.PI * (284 + t.dayOfYear)) / 365);
  const utcHours = ((slot * SLOT_MS) % 86_400_000) / 3_600_000;
  const solarHours = utcHours + 31.24 / 15;
  const hourAngle = ((solarHours - 12) * 15 * Math.PI) / 180;
  return Math.asin(Math.sin(latitude) * Math.sin(declination) + Math.cos(latitude) * Math.cos(declination) * Math.cos(hourAngle));
}

// ---- the building ------------------------------------------------------------------------------------

export interface BmsReading {
  kw_x10: number;
  kwh_x10: number;
  solar_kw_x10: number;
  solar_kwh_x10: number;
  grid_cost: number;
  solar_saving: number;
  mdb_volts: number;
  mdb_amps_x10: number;
  generator: number;
  fuel_pct: number;
  water_tank_pct: number;
  water_flow_x10: number;
  pumps: number;
  co2_ppm: number;
  temp_x10: number;
  humidity_pct: number;
  fans: number;
  net_down_kbps: number;
  net_up_kbps: number;
  ping_ms: number;
  uptime_x100: number;
  cameras_online: number;
  cameras_total: number;
  elevator_state: number;
  elevator_floor: number;
  fire_panel: number;
  gates: number;
  fault_code: number;
}

/** Fault codes. None is about safety. */
export const FAULT = { none: 0, cameraOffline: 1, pumpMaintenance: 2, slowInternet: 3, elevatorService: 4, fanService: 5 } as const;

/** Pumps bitmask: booster running, lifting pump running, booster in maintenance, lifting pump in maintenance. */
export const PUMP = { boosterRunning: 1, liftingRunning: 2, boosterMaintenance: 4, liftingMaintenance: 8 } as const;

/** Simulated tariff for the building's grid energy, piastres per kWh. Illustrative, not a published price. */
const TARIFF_PIASTRES = 220;
const SOLAR_CAPACITY_KW = 320;
const CAMERAS = 24;
const FLOORS = 12;

/** A fault lasting a few hours: chosen per 4-hour block, so it doesn't flicker slot to slot. */
const blockFault = (seed: number, key: number, slot: number, stream: number, chance: number) => noise(seed, key, Math.floor(slot / 16), stream) < chance;

export function bmsReading(seed: number, siteKey: number, slot: number): BmsReading {
  const t = cairoTime(slot);
  const n = (stream: number) => noise(seed, siteKey, slot, stream);
  const w = (stream: number) => wobble(seed, siteKey, slot, stream);
  const people = occupancy(t);
  const temperature = outdoorTemperature(t, w(1));
  const cooling = Math.max(0, temperature - 22) * 34 * (0.55 + 0.45 * people);
  const kw = Math.max(120, 260 + people * 280 + cooling + w(2) * 18);
  const elevation = sunElevation(slot, t);
  const clouds = 0.82 + 0.18 * noise(seed, siteKey, Math.floor(slot / 96), 3);
  const solarKw = elevation > 0 ? SOLAR_CAPACITY_KW * Math.sin(elevation) ** 1.15 * clouds : 0;
  const gridKw = Math.max(0, kw - solarKw);

  let fault: number = FAULT.none;
  const cameraOffline = blockFault(seed, siteKey, slot, 10, 0.012);
  const pumpService = blockFault(seed, siteKey, slot, 11, 0.006);
  const slowNet = blockFault(seed, siteKey, slot, 12, 0.008);
  const fanService = blockFault(seed, siteKey, slot, 13, 0.004);
  // The elevator's monthly service: the 15th, 10:00 to 12:00.
  const elevatorService = t.dayOfMonth === 15 && t.hour >= 10 && t.hour < 12;
  if (cameraOffline) fault = FAULT.cameraOffline;
  if (pumpService) fault = FAULT.pumpMaintenance;
  if (slowNet) fault = FAULT.slowInternet;
  if (fanService) fault = FAULT.fanService;
  if (elevatorService) fault = FAULT.elevatorService;

  // A short grid outage now and then (summer evenings): the generator runs.
  const outage = t.month >= 5 && t.month <= 8 && t.hour >= 18 && t.hour < 23 && blockFault(seed, siteKey, slot, 14, 0.01);
  const evening = Math.exp(-(((t.hour - 21) / 2.5) ** 2));
  const tankCycle = 0.62 + 0.28 * Math.cos(((t.hour - 4) / 24) * 2 * Math.PI) - people * 0.08 + w(4) * 0.03;
  const refilling = t.hour < 5.5;
  const boosterRunning = people > 0.35 && !pumpService;
  const downMbps = slowNet ? 6 + n(5) * 4 : 118 * (1 - 0.42 * evening) + w(6) * 6;
  const elevatorMoving = n(7) < 0.2 + people * 0.5;
  const floor = Math.floor(noise(seed, siteKey, slot, 8) * (FLOORS + 1));

  return {
    kw_x10: Math.round(kw * 10),
    kwh_x10: Math.round(kw * 0.25 * 10),
    solar_kw_x10: Math.round(solarKw * 10),
    solar_kwh_x10: Math.round(solarKw * 0.25 * 10),
    grid_cost: Math.round(gridKw * 0.25 * TARIFF_PIASTRES),
    solar_saving: Math.round(solarKw * 0.25 * TARIFF_PIASTRES),
    mdb_volts: Math.round(229 + w(9) * 3),
    mdb_amps_x10: Math.round(((gridKw * 1000) / (1.732 * 400 * 0.92)) * 10),
    generator: outage ? 2 : 1,
    fuel_pct: Math.round(96 - ((t.dayOfMonth - 1) / 30) * 22 - (outage ? 1 : 0)),
    water_tank_pct: Math.round(Math.min(98, Math.max(28, tankCycle * 100))),
    water_flow_x10: Math.round((8 + people * 34 + w(15) * 2) * 10),
    pumps: (boosterRunning ? PUMP.boosterRunning : 0) | (refilling ? PUMP.liftingRunning : 0) | (pumpService ? PUMP.boosterMaintenance : 0),
    co2_ppm: Math.round(430 + people * 520 + w(16) * 25),
    temp_x10: Math.round(temperature * 10),
    humidity_pct: Math.round(48 + 12 * Math.cos(((t.hour - 5) / 24) * 2 * Math.PI) + w(17) * 4),
    fans: fanService ? 1 : 0,
    net_down_kbps: Math.round(Math.max(2, downMbps) * 1000),
    net_up_kbps: Math.round(Math.max(1, downMbps * 0.62) * 1000),
    ping_ms: Math.round(slowNet ? 95 + n(18) * 60 : 9 + evening * 9 + n(18) * 4),
    uptime_x100: Math.round(9990 + n(19) * 9),
    cameras_online: CAMERAS - (cameraOffline ? 1 : 0),
    cameras_total: CAMERAS,
    elevator_state: elevatorService ? 3 : elevatorMoving ? (n(20) < 0.5 ? 1 : 2) : 0,
    elevator_floor: elevatorService ? 0 : floor,
    fire_panel: 0,
    gates: 0,
    fault_code: fault,
  };
}

// ---- an apartment ------------------------------------------------------------------------------------

export interface EnergyReading {
  total_wh: number;
  lighting_wh: number;
  ac_wh: number;
  media_wh: number;
  other_wh: number;
}

/** One apartment's quarter hour: size and habits vary by apartment, from its key. */
export function unitEnergy(seed: number, unitKey: number, slot: number): EnergyReading {
  const t = cairoTime(slot);
  const size = 0.7 + noise(seed, unitKey, 0, 30) * 0.7;
  const n = (stream: number) => noise(seed, unitKey, slot, stream);
  const people = occupancy(t) * (0.8 + noise(seed, unitKey, Math.floor(slot / 96), 31) * 0.4);
  const temperature = outdoorTemperature(t, wobble(seed, 7, slot, 1));
  const dark = t.hour < 6.5 || t.hour > 17.5 ? 1 : 0.15;
  const lighting = size * 70 * people * dark * (0.8 + n(32) * 0.4);
  const ac = size * Math.max(0, temperature - 23) * 165 * (0.4 + 0.6 * people) * (n(33) < 0.85 ? 1 : 0.3);
  const media = size * 55 * Math.exp(-(((t.hour - 21) / 2.2) ** 2)) * people * (0.6 + n(34) * 0.8);
  const other = size * (95 + people * 60) * (0.85 + n(35) * 0.3);
  // Watts over a quarter hour → watt-hours.
  const wh = (watts: number) => Math.round(watts * 0.25);
  const reading = { lighting_wh: wh(lighting), ac_wh: wh(ac), media_wh: wh(media), other_wh: wh(other) };
  return { ...reading, total_wh: reading.lighting_wh + reading.ac_wh + reading.media_wh + reading.other_wh };
}
