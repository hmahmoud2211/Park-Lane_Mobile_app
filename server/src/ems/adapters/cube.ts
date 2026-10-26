import * as cube from '../../cube/cubeClient.ts';
import { canSwitch } from '../../devices.ts';
import { ApiError } from '../../errors.ts';
import { plugEvents } from '../../sonoff/bridge.ts';
import type { AdapterDevice, DeviceAdapter, HardwareReport } from './types.ts';

/**
 * A device on the unit's CUBE hub, switched through the hub's Open API. The
 * SONOFF wizard registers plugs on CUBE (as a third-party device the bridge
 * drives) and then here, so the hub, the app and Alexa all control the same
 * device through one path.
 *
 * CUBE only answers a switch command once the device confirmed it; for a
 * bridged plug, that is after the plug acknowledged over the LAN (see
 * sonoff/bridge.ts handleDirective). A refused or unanswered command is
 * reported as unreachable, never as switched.
 */

const SERIAL = /^[\w.:-]{1,128}$/;

function serialOf(device: AdapterDevice): string {
  const serial = (device.config as { serial?: unknown } | null)?.serial;
  if (typeof serial !== 'string') {
    throw new ApiError('internal', 'This device has no hub serial number. Remove it and add it again.');
  }
  return serial;
}

function hubFailure(error: unknown): ApiError {
  if (error instanceof ApiError && error.code === 'cube_unreachable') {
    return new ApiError('device_unreachable', 'The CUBE hub could not be reached.');
  }
  if (error instanceof ApiError && (error.code === 'cube_rejected' || error.code === 'cube_auth')) {
    return new ApiError('device_unreachable', 'The CUBE hub could not switch the device.');
  }
  return error instanceof ApiError ? error : new ApiError('device_unreachable', 'The CUBE hub could not switch the device.');
}

export const cubeAdapter: DeviceAdapter = {
  protocol: 'cube',
  types: ['plug', 'switch', 'light'],
  simulated: false,

  async prepare(input) {
    const serial = typeof input.serial === 'string' ? input.serial : '';
    if (!SERIAL.test(serial)) {
      throw new ApiError('bad_request', 'cube.serial must be the device’s hub serial number.');
    }
    const found = await cube.getDevice(serial).catch((error: unknown) => {
      throw hubFailure(error);
    });
    if (!found) {
      throw new ApiError('device_not_found', 'The CUBE hub has no device with this serial number.');
    }
    if (!canSwitch(found)) {
      throw new ApiError('unsupported_device', 'The CUBE hub cannot switch this device.');
    }
    const power = found.state?.power?.powerState;
    return {
      config: { serial },
      externalId: serial,
      online: found.online,
      power: power === 'on' || power === 'off' ? power : 'unknown',
    };
  },

  async setPower(device, power) {
    try {
      await cube.setPower(serialOf(device), power === 'on');
    } catch (error) {
      throw hubFailure(error);
    }
  },

  start(report: (report: HardwareReport) => void) {
    // Plugs the bridge drives: their own button, a switch from the CUBE dashboard, going quiet.
    plugEvents.on('change', (change) => {
      report({
        protocol: 'cube',
        externalId: change.cubeSerial,
        ...(change.online !== undefined ? { online: change.online } : {}),
        ...(change.power ? { power: change.power } : {}),
      });
    });
  },
};
