/**
 * The resident's home as the EMS backend serves it, from the unit's Home
 * Assistant. The wire types are shared with the backend (shared/contracts);
 * this file adds what only the app knows, so change the contract there.
 */

import type { CommandRequest, Device as WireDevice } from '../../../shared/contracts/home';
import type { IntegrationOption } from '../../../shared/contracts/accounts';

export type {
  AlarmCapability,
  BrightnessCapability,
  Capability,
  CapabilityType,
  ClimateCapability,
  ColorCapability,
  ColorTempCapability,
  CoverCapability,
  DeviceKind,
  FanCapability,
  Home,
  HubStatus,
  HumidifierCapability,
  LockCapability,
  MediaCapability,
  MowerCapability,
  NumberCapability,
  OptionCapability,
  PowerCapability,
  PressCapability,
  Room,
  SensorReading,
  VacuumCapability,
  ValveCapability,
  WaterHeaterCapability,
} from '../../../shared/contracts/home';

export type {
  FlowField,
  FlowFieldKind,
  FlowStep,
  FlowStepType,
  LinkedAccount,
  LinkMethod,
} from '../../../shared/contracts/accounts';

/** A device as the app shows it: the backend's, or one the app maps from a CUBE Gateway. */
export interface Device extends WireDevice {
  /**
   * Where the device lives: the building's Home Assistant hub (cloud-linked
   * accounts, the default) or the resident's own CUBE Gateway on their Wi-Fi.
   */
  source?: 'hub' | 'gateway';
  /**
   * The state shown is what the gateway expects, not what the device reported
   * (a TV that gives no feedback after a key press). Cards say so.
   */
  assumed?: boolean;
  /** Reverse engineered or model-dependent integration (gateway devices). */
  experimental?: boolean;
}

export type Command = CommandRequest;

/** A brand the resident can link, and whether the building has enabled it. */
export type Integration = IntegrationOption;
