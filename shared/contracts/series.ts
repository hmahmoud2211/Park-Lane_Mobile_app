/**
 * Quarter-hour readings: GET /api/sites/me/bms/latest | /series (the compound's building systems) and
 * GET /api/units/me/energy/latest | /series (the apartment's energy). `source` says whether the numbers are
 * simulated (a demo site) or live; the app shows "Simulated data" for the first.
 */

export type SeriesSource = 'simulated' | 'live';

export type ComponentState = 'normal' | 'service' | 'fault';

export interface BmsReadingView {
  power: { kw: number; kwhThisQuarter: number; solarKw: number; gridCostEgp: number; solarSavingEgp: number };
  mdb: { volts: number; amps: number };
  generator: { state: 'standby' | 'running'; fuelPct: number };
  water: { tankPct: number; flowLpm: number; booster: 'running' | 'idle' | 'service'; lifting: 'running' | 'idle' | 'service' };
  air: { co2ppm: number; temperatureC: number; humidityPct: number };
  fans: { pressurization: ComponentState; jet: ComponentState; exhaust: ComponentState; freshAir: ComponentState };
  internet: { downMbps: number; upMbps: number; pingMs: number; uptimePct: number; quality: 'excellent' | 'good' | 'slow' };
  cameras: { online: number; total: number };
  elevator: { state: 'idle' | 'up' | 'down' | 'service'; floor: number };
  firePanel: 'normal';
  gates: { parking: ComponentState; entrance: ComponentState; roof: ComponentState };
  /** A non-safety fault, if one is open. */
  fault: { code: number; label: string } | null;
  /** Share of systems reporting normal, 0-1. */
  health: number;
  /** How many systems are reporting. */
  systems: number;
}

export interface BmsLatest {
  source: SeriesSource;
  /** When this quarter hour began, and when the next reading is due. */
  at: string;
  nextAt: string;
  reading: BmsReadingView;
}

export interface EnergyLatest {
  source: SeriesSource;
  at: string;
  nextAt: string;
  /** This quarter hour, in kWh. */
  quarter: { total: number; lighting: number; ac: number; media: number; other: number };
  /** Since midnight on the compound's clock, in kWh. */
  today: { total: number; lighting: number; ac: number; media: number; other: number };
  /** The average power over this quarter hour, in kW. */
  kw: number;
}

export interface SeriesPoint {
  at: string;
  avg: Record<string, number>;
  min: Record<string, number>;
  max: Record<string, number>;
}

export interface SeriesAnswer {
  source: SeriesSource;
  bucket: '15m' | '1h' | '1d';
  metrics: string[];
  points: SeriesPoint[];
}
