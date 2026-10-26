/**
 * How the registry drives one kind of hardware. Every adapter must only
 * resolve `setPower` once the device itself confirmed the new state, so the
 * registry never stores, or tells Alexa, a state that did not happen.
 */

export type DeviceType = 'switch' | 'plug' | 'light' | 'virtual';
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
  /** Starts watching hardware, for adapters that can hear it change by itself. */
  start?(report: (report: HardwareReport) => void, known: () => AdapterDevice[]): void;
}
