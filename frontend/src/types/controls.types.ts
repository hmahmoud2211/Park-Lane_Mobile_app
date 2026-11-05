/**
 * A device's settings beyond its basic controls, as the AC Controls screen
 * shows them (ported from Master's ems.types, archive/master-2026-11-04).
 * Built from the gateway's device (`settings`, the climate capability and
 * readings) by toDeviceControls in services/gateway/deviceMapping.ts.
 */

export type ControlValue = string | number | boolean | null;

/**
 * One setting or reading, e.g. an AC's mode, set point, swing, Jet, a timer
 * or its filter hours. The device only lists what it supports. `select`,
 * `number`, `switch` and `button` can be set; `sensor` only reads.
 */
export interface ControlSetting {
  /** e.g. `mode`, `temperature`, `fan_mode`, `swing_mode`, `jet`, `sleeptimer`, `filterused`. */
  key: string;
  kind: 'select' | 'number' | 'switch' | 'button' | 'sensor';
  name: string;
  /** What the device last reported (or, when `confirmed` is false, what was last sent); null when unknown. */
  value: ControlValue;
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
  /** False when the device has not echoed this value back. */
  confirmed: boolean;
}

export type ControlPower = 'on' | 'off' | 'unknown';

/** A device's settings beyond power and its live readings. */
export interface DeviceControls {
  online: boolean;
  power: ControlPower;
  /** What it is doing now, e.g. cooling, idle, off; null when it does not say. */
  action: string | null;
  currentTemperature: number | null;
  currentHumidity: number | null;
  settings: ControlSetting[];
}
