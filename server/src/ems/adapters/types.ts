/**
 * How the registry drives one kind of hardware. Every adapter must only
 * resolve `setPower` once the device itself confirmed the new state, so the
 * registry never stores, or tells Alexa, a state that did not happen.
 */

export type DeviceType = 'switch' | 'plug' | 'light' | 'ac' | 'virtual';
export type Power = 'on' | 'off' | 'unknown';

export interface AdapterDevice {
  id: string;
  online: boolean;
  /** The adapter's own settings, as `prepare` returned them. */
  config: Record<string, unknown> | null;
}

export interface Prepared {
  config: Record<string, unknown> | null;
  /** The hardware id, for adapters whose devices have one; registering it twice is refused. */
  externalId: string | null;
  online: boolean;
  power: Power;
}

/** A change the hardware reported by itself (its own button, going quiet). */
export interface HardwareReport {
  protocol: string;
  externalId: string;
  online?: boolean;
  power?: 'on' | 'off';
  /** New adapter settings, e.g. the address it announced from. */
  config?: Record<string, unknown>;
  /** Something `readControls` returns may have changed (a setting, a reading). */
  controlsChanged?: boolean;
}

/**
 * One setting or reading beyond power, e.g. an AC's mode, set point, swing,
 * Jet, a timer or its filter hours. `select`, `number`, `switch` and `button`
 * can be set; `sensor` only reads.
 */
export interface ControlSetting {
  key: string;
  kind: 'select' | 'number' | 'switch' | 'button' | 'sensor';
  name: string;
  /** What the device last reported; null when it has not said. */
  value: string | number | boolean | null;
  options?: string[];
  min?: number;
  max?: number;
  step?: number;
  unit: string | null;
  /** False while the device would ignore it, e.g. Jet outside Cooling. */
  available: boolean;
  /** What it needs to be available, as the manufacturer puts it. */
  requires: string | null;
  description: string | null;
  /** A technical reading most people never need. */
  diagnostic: boolean;
}

/** A device's settings beyond power (GET /api/devices/:id/controls). */
export interface DeviceControls {
  online: boolean;
  power: Power;
  /** What it is doing now, e.g. cooling, idle, off; null when it does not say. */
  action: string | null;
  currentTemperature: number | null;
  currentHumidity: number | null;
  settings: ControlSetting[];
}

export interface DeviceAdapter {
  readonly protocol: string;
  readonly types: readonly DeviceType[];
  /** True for adapters with no hardware behind them; the app labels such devices. */
  readonly simulated: boolean;
  /** Checks the hardware exists and is usable before it is registered. */
  prepare(input: Record<string, unknown>): Promise<Prepared>;
  /** Resolves when the device confirmed; throws ApiError (device_offline, device_unreachable) otherwise. */
  setPower(device: AdapterDevice, power: 'on' | 'off'): Promise<void>;
  /** Settings beyond power, for adapters whose devices have them. */
  readControls?(device: AdapterDevice): DeviceControls;
  /** Changes one of them; resolves once the device confirmed it, like setPower. */
  setControl?(device: AdapterDevice, key: string, value: unknown): Promise<void>;
  /** Starts watching hardware, for adapters that can hear it change by itself. */
  start?(report: (report: HardwareReport) => void, known: () => AdapterDevice[]): void;
}
