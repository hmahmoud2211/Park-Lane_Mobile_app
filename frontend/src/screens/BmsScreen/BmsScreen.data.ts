import type { ImageKey } from '../../constants/images';
import type { IconSet } from '../../types/icons.types';

/**
 * Content for the BMS (Building Management System) screen. Wording and figures
 * match the Figma reference (assets/Screens/screen15.png, continued in
 * screen16.png and screen17.png), line breaks included. There is no building
 * systems feed yet, so these are sample readings, shaped the way a status feed
 * would deliver them: wiring one up later replaces this module, not the screen.
 *
 * TODO(api): load the readings from the BMS once it exposes them.
 */

export const bmsCopy = {
  title: 'Building Management System',
  bannerTitle: 'Everything operating\nnormally',
  bannerBody: 'Owner visibility into core\nbuilding systems.',
  bannerStatus: 'All Systems Normal',
  healthLabel: 'System Health',
  ventilationTitle: 'Ventilation Fans',
  electricalTitle: 'Electrical System',
  internetTitle: 'Internet',
  downloadCaption: 'Download Speed',
  // The reference reads "Security&  CCTV"; set with the spacing its other headings use.
  securityTitle: 'Security & CCTV',
  previousCamera: 'Previous camera',
  nextCamera: 'Next camera',
  elevatorTitle: 'Elevator',
  waterTitle: 'Water Pump',
  fireTitle: 'Fire & Life Safety',
  lastMaintenance: 'Last Maintenance :',
} as const;

/**
 * How a reading is coloured: `ok` in the status aqua ("Normal", "Running",
 * "Ready"), `good` in the green the reference gives "Excellent", and `plain`
 * in white, for a value that is not a state (e.g. "First Floor").
 */
export type ReadingTone = 'ok' | 'good' | 'plain';

interface Glyph {
  iconSet: IconSet;
  iconName: string;
}

/** Fractions shown as whole percentages, e.g. 0.82 as "82%". */
export function percent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/* ---------------------------------------------------------------- Overview */

/** Share of the building's systems reporting healthy, 0-1. */
export const systemHealth = 0.89;

export interface SummaryFigure extends Glyph {
  id: string;
  label: string;
  value: string;
}

/** The two figures beside the health ring. */
export const summaryFigures: readonly SummaryFigure[] = [
  { id: 'connected', label: 'System Connected', value: '12 System', iconSet: 'material', iconName: 'server' },
  { id: 'updated', label: 'Last Update :', value: '25/10/2026', iconSet: 'ionicons', iconName: 'time-outline' },
];

/* ---------------------------------------------------------- Ventilation fans */

export interface StatusReading {
  id: string;
  name: string;
  status: string;
  tone: ReadingTone;
}

/** Drawn two either side of the fan, in this order: left column, then right. */
export const ventilationFans: readonly StatusReading[] = [
  { id: 'pressurization', name: 'Pressurization fan', status: 'Normal', tone: 'ok' },
  { id: 'jet', name: 'Jet fan', status: 'Normal', tone: 'ok' },
  { id: 'exhaust', name: 'Exhaust fan', status: 'Normal', tone: 'ok' },
  { id: 'fresh-air', name: 'Fresh Air fan', status: 'Normal', tone: 'ok' },
];

/* --------------------------------------------------------- Electrical system */

/** The main distribution board, with its two live figures. */
export const mainBoard = {
  name: 'MDB',
  status: 'Normal',
  // As the reference writes them; the current is labelled with its symbol, I.
  figures: ['220 V', '31 I'],
} as const;

export const generator = {
  name: 'Generator',
  status: 'Standby',
  tankLabel: 'Solar Tank',
  tankLevel: 0.82,
} as const;

export interface EnergyFeed {
  id: string;
  title: string;
  power: string;
  cost: string;
}

export const energyFeeds: readonly EnergyFeed[] = [
  { id: 'service', title: 'Electrical Service', power: '786 KW', cost: '890 EGP' },
  { id: 'solar', title: 'Solar Energy', power: '231 KW', cost: '216 EGP' },
];

/* ------------------------------------------------------------------ Internet */

export const internet = {
  download: 86.4,
  unit: 'Mbps',
  /**
   * Full scale of the speed gauge. Not printed in the reference; 120 Mbps puts
   * the needle where it is drawn for 86.4.
   */
  gaugeMax: 120,
} as const;

export interface NetworkReading extends Glyph {
  id: string;
  label: string;
  value: string;
  /** Set after the value in the muted colour, e.g. "Mbps". */
  unit?: string;
  tone: ReadingTone;
}

export const networkReadings: readonly NetworkReading[] = [
  { id: 'connection', label: 'Connection', value: 'Excellent', tone: 'good', iconSet: 'ionicons', iconName: 'shield-checkmark' },
  { id: 'upload', label: 'Upload', value: '56.72', unit: 'Mbps', tone: 'plain', iconSet: 'ionicons', iconName: 'cloud-upload' },
  { id: 'ping', label: 'PING', value: '12', unit: 'ms', tone: 'plain', iconSet: 'ionicons', iconName: 'speedometer' },
];

/* ---------------------------------------------------------- Security & CCTV */

export interface GlyphReading extends StatusReading, Glyph {}

export const gates: readonly GlyphReading[] = [
  { id: 'parking', name: 'Parking Gate', status: 'Normal', tone: 'ok', iconSet: 'material', iconName: 'boom-gate-up' },
  { id: 'entrance', name: 'Entrance Gate', status: 'Normal', tone: 'ok', iconSet: 'material', iconName: 'door-sliding' },
  { id: 'roof', name: 'Roof Gate', status: 'Normal', tone: 'ok', iconSet: 'material', iconName: 'location-enter' },
];

export interface CameraFeed {
  id: string;
  name: string;
  /** The latest still from the camera. */
  snapshot: ImageKey;
}

/**
 * The cameras the CCTV card steps through with its arrows. The reference shows
 * one; the arrows come alive as soon as a second is listed.
 */
export const cameras: readonly CameraFeed[] = [
  { id: 'entrance-1', name: 'Entrance 1', snapshot: 'bmsCctvEntrance' },
];

/* ------------------------------------------------------------------ Elevator */

export interface DetailRow {
  id: string;
  label: string;
  value: string;
  tone: ReadingTone;
}

export const elevator = {
  name: 'Elevator 1',
  status: 'Normal',
  rows: [
    { id: 'floor', label: 'Current Floor', value: 'First Floor', tone: 'plain' },
    { id: 'maintenance', label: 'Maintenance', value: 'Normal', tone: 'ok' },
    { id: 'power', label: 'Power Supply', value: 'Normal', tone: 'ok' },
  ] satisfies readonly DetailRow[],
} as const;

/* ---------------------------------------------------------------- Water pump */

export const waterTank = {
  label: 'Tank Level',
  level: 0.82,
} as const;

export const pumps: readonly GlyphReading[] = [
  { id: 'booster', name: 'Booster Pump', status: 'Running', tone: 'ok', iconSet: 'material', iconName: 'engine-outline' },
  { id: 'lifting', name: 'Lifting Pump', status: 'Running', tone: 'ok', iconSet: 'material', iconName: 'water-pump' },
  { id: 'pressure', name: 'Water Pressure', status: 'Stable', tone: 'ok', iconSet: 'material', iconName: 'gauge' },
];

/* -------------------------------------------------------- Fire & Life Safety */

export interface SafetySystem extends GlyphReading {
  lastMaintenance: string;
}

export const safetySystems: readonly SafetySystem[] = [
  {
    id: 'alarm',
    name: 'Fire Alarm',
    status: 'Normal',
    tone: 'ok',
    lastMaintenance: '15/10/2026',
    iconSet: 'material',
    iconName: 'smoke-detector-variant',
  },
  {
    id: 'pump',
    name: 'Fire Pump',
    status: 'Ready',
    tone: 'ok',
    lastMaintenance: '15/10/2026',
    iconSet: 'material',
    iconName: 'fire-hydrant',
  },
  {
    id: 'tank',
    name: 'Fire Tank',
    status: 'Normal',
    tone: 'ok',
    lastMaintenance: '15/10/2026',
    iconSet: 'material',
    iconName: 'fire-extinguisher',
  },
];

/* ------------------------------------------------------- From the building */

/** Everything the screen draws: the design's sample above, or the compound's latest quarter-hour reading. */
export interface BmsView {
  systemHealth: number;
  summaryFigures: readonly SummaryFigure[];
  ventilationFans: readonly StatusReading[];
  mainBoard: { name: string; status: string; figures: readonly string[] };
  generator: { name: string; status: string; tankLabel: string; tankLevel: number };
  energyFeeds: readonly EnergyFeed[];
  internet: { download: number; unit: string; gaugeMax: number };
  networkReadings: readonly NetworkReading[];
  gates: readonly GlyphReading[];
  cameras: readonly CameraFeed[];
  elevator: { name: string; status: string; rows: readonly DetailRow[] };
  waterTank: { label: string; level: number };
  pumps: readonly GlyphReading[];
  safetySystems: readonly SafetySystem[];
  banner: { title: string; status: string };
  /** "Simulated data" (a demo compound), "Sample data" (the design's figures), or nothing for live readings. */
  dataLabel: string | null;
}

export const sampleBms: BmsView = {
  systemHealth,
  summaryFigures,
  ventilationFans,
  mainBoard,
  generator,
  energyFeeds,
  internet,
  networkReadings,
  gates,
  cameras,
  elevator,
  waterTank,
  pumps,
  safetySystems,
  banner: { title: bmsCopy.bannerTitle, status: bmsCopy.bannerStatus },
  dataLabel: 'Sample data',
};

const stateLabel = (state: 'normal' | 'service' | 'fault') => (state === 'normal' ? 'Normal' : state === 'service' ? 'In service' : 'Fault');
const toneOf = (state: string): ReadingTone => (state === 'normal' || state === 'running' || state === 'idle' ? 'ok' : 'plain');
const ordinal = (floor: number) => (floor === 0 ? 'Ground Floor' : `Floor ${floor}`);
const egp = (value: number) => `${Math.round(value).toLocaleString('en-US')} EGP`;
const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: 'Africa/Cairo' });

/** The design's panels, filled from one quarter-hour reading of the compound's building systems. */
export function bmsViewFrom(latest: import('../../../../shared/contracts/series').BmsLatest): BmsView {
  const r = latest.reading;
  const pumpStatus = (state: 'running' | 'idle' | 'service') => (state === 'running' ? 'Running' : state === 'idle' ? 'Standby' : 'In service');
  const allNormal = r.fault === null;
  return {
    systemHealth: r.health,
    summaryFigures: [
      { id: 'connected', label: 'System Connected', value: `${r.systems} System`, iconSet: 'material', iconName: 'server' },
      { id: 'updated', label: 'Last Update :', value: clock(latest.at), iconSet: 'ionicons', iconName: 'time-outline' },
    ],
    ventilationFans: [
      { id: 'pressurization', name: 'Pressurization fan', status: stateLabel(r.fans.pressurization), tone: toneOf(r.fans.pressurization) },
      { id: 'jet', name: 'Jet fan', status: stateLabel(r.fans.jet), tone: toneOf(r.fans.jet) },
      { id: 'exhaust', name: 'Exhaust fan', status: stateLabel(r.fans.exhaust), tone: toneOf(r.fans.exhaust) },
      { id: 'fresh-air', name: 'Fresh Air fan', status: stateLabel(r.fans.freshAir), tone: toneOf(r.fans.freshAir) },
    ],
    mainBoard: { name: 'MDB', status: r.mdb.volts >= 210 && r.mdb.volts <= 245 ? 'Normal' : 'Check', figures: [`${r.mdb.volts} V`, `${Math.round(r.mdb.amps)} A`] },
    generator: { name: 'Generator', status: r.generator.state === 'running' ? 'Running' : 'Standby', tankLabel: 'Solar Tank', tankLevel: r.generator.fuelPct / 100 },
    energyFeeds: [
      { id: 'service', title: 'Electrical Service', power: `${Math.round(r.power.kw)} KW`, cost: `${egp(r.power.gridCostEgp * 4)}/h` },
      { id: 'solar', title: 'Solar Energy', power: `${Math.round(r.power.solarKw)} KW`, cost: `${egp(r.power.solarSavingEgp * 4)}/h` },
    ],
    internet: { download: r.internet.downMbps, unit: 'Mbps', gaugeMax: 120 },
    networkReadings: [
      {
        id: 'connection',
        label: 'Connection',
        value: r.internet.quality === 'excellent' ? 'Excellent' : r.internet.quality === 'good' ? 'Good' : 'Slow',
        tone: r.internet.quality === 'slow' ? 'plain' : 'good',
        iconSet: 'ionicons',
        iconName: 'shield-checkmark',
      },
      { id: 'upload', label: 'Upload', value: r.internet.upMbps.toFixed(2), unit: 'Mbps', tone: 'plain', iconSet: 'ionicons', iconName: 'cloud-upload' },
      { id: 'ping', label: 'PING', value: String(r.internet.pingMs), unit: 'ms', tone: 'plain', iconSet: 'ionicons', iconName: 'speedometer' },
    ],
    gates: [
      { id: 'parking', name: 'Parking Gate', status: stateLabel(r.gates.parking), tone: toneOf(r.gates.parking), iconSet: 'material', iconName: 'boom-gate-up' },
      { id: 'entrance', name: 'Entrance Gate', status: stateLabel(r.gates.entrance), tone: toneOf(r.gates.entrance), iconSet: 'material', iconName: 'door-sliding' },
      { id: 'roof', name: 'Roof Gate', status: stateLabel(r.gates.roof), tone: toneOf(r.gates.roof), iconSet: 'material', iconName: 'location-enter' },
    ],
    cameras: cameras.map((camera) => ({ ...camera, name: `${camera.name} · ${r.cameras.online}/${r.cameras.total} online` })),
    elevator: {
      name: 'Elevator 1',
      status: r.elevator.state === 'service' ? 'In service' : 'Normal',
      rows: [
        { id: 'floor', label: 'Current Floor', value: r.elevator.state === 'service' ? '—' : ordinal(r.elevator.floor), tone: 'plain' },
        { id: 'maintenance', label: 'Maintenance', value: r.elevator.state === 'service' ? 'Monthly service' : 'Normal', tone: r.elevator.state === 'service' ? 'plain' : 'ok' },
        { id: 'power', label: 'Power Supply', value: r.generator.state === 'running' ? 'Generator' : 'Normal', tone: 'ok' },
      ],
    },
    waterTank: { label: 'Tank Level', level: r.water.tankPct / 100 },
    pumps: [
      { id: 'booster', name: 'Booster Pump', status: pumpStatus(r.water.booster), tone: toneOf(r.water.booster), iconSet: 'material', iconName: 'engine-outline' },
      { id: 'lifting', name: 'Lifting Pump', status: pumpStatus(r.water.lifting), tone: toneOf(r.water.lifting), iconSet: 'material', iconName: 'water-pump' },
      { id: 'pressure', name: 'Water Flow', status: `${Math.round(r.water.flowLpm)} L/min`, tone: 'ok', iconSet: 'material', iconName: 'gauge' },
    ],
    // The fire panel always reads normal in this feed; maintenance dates stay as building management records them.
    safetySystems,
    banner: {
      title: allNormal ? bmsCopy.bannerTitle : `Attention:\n${r.fault!.label.toLowerCase()}`,
      status: allNormal ? bmsCopy.bannerStatus : 'One system needs attention',
    },
    dataLabel: latest.source === 'simulated' ? 'Simulated data' : null,
  };
}
