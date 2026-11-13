/** Smart-home state shared by the hub and gateway device hooks. */

import type { Capability, DeviceKind } from '../../types/home.types';

export type DeviceBusy = 'command' | 'edit';

/** What every control on a device's screen needs from it (DeviceControl hands it down). */
export interface ControlKit {
  deviceName: string;
  kind: DeviceKind;
  /** The device is not responding: controls are dimmed and do nothing. */
  disabled: boolean;
  /** A command from this screen is on its way: controls wait (without dimming) until it lands. */
  waiting: boolean;
  /** Whether the control with this key sent the command in flight, so it shows it is working. */
  isBusy: (key: string) => boolean;
  /** Sends one command; `key` names the pressed control (default: capability, action and value). */
  send: (capability: Capability, action: string, value?: unknown, key?: string) => void;
}
