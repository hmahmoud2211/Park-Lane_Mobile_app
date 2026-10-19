import type { CubeDevice } from './cube/cubeClient.ts';

/** A hub device as the app sees it (BackendDevice in src/types/sonoff.types.ts). */
export interface ApiDevice {
  id: string;
  name: string;
  category: string;
  manufacturer: string;
  model: string;
  online: boolean;
  power: 'on' | 'off' | null;
  controllable: boolean;
}

/**
 * Permissions are 8421 bit strings, read left to right as control, report,
 * configure, query; the first bit says whether the hub may switch it.
 */
export function canSwitch(device: CubeDevice): boolean {
  return device.capabilities.some((entry) => entry.capability === 'power' && entry.permission.startsWith('1'));
}

export function toApiDevice(device: CubeDevice): ApiDevice {
  const power = device.state?.power?.powerState;
  return {
    id: device.serial_number,
    name: device.name,
    category: device.display_category,
    manufacturer: device.manufacturer,
    model: device.model,
    online: device.online,
    power: power === 'on' || power === 'off' ? power : null,
    controllable: canSwitch(device),
  };
}
