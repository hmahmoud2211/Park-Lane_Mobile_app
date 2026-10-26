import { ApiError } from '../../errors.ts';
import type { DeviceAdapter } from './types.ts';

/**
 * A switch with no hardware behind it, for testing the whole path (app,
 * Alexa, realtime) before a physical device is supported. Its state lives
 * only in the registry, and the app and voice replies label it "virtual".
 * Marking it offline (PATCH { online: false }) simulates a dead device.
 */
export const virtualAdapter: DeviceAdapter = {
  protocol: 'virtual',
  types: ['virtual', 'switch', 'plug', 'light'],
  simulated: true,

  async prepare() {
    return { config: null, externalId: null, online: true, power: 'off' };
  },

  async setPower(device) {
    if (!device.online) {
      throw new ApiError('device_offline', 'This virtual switch is set to offline.');
    }
  },
};
