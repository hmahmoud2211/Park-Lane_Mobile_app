import { ApiError } from '../../errors.ts';
import { applianceEvents, getAppliance, isConfigured, isConnected, setAppliancePower } from '../../rethink/appliances.ts';
import type { AdapterDevice, DeviceAdapter, HardwareReport } from './types.ts';

/**
 * An LG appliance paired with rethink, the local stand-in for LG's ThinQ
 * cloud (see rethink/appliances.ts and docker/rethink). Only power is driven
 * today; it resolves once the appliance reported the new state back.
 */

function applianceId(device: AdapterDevice): string {
  const id = (device.config as { applianceId?: unknown } | null)?.applianceId;
  if (typeof id !== 'string') {
    throw new ApiError('internal', 'This appliance has no rethink ID. Remove it and add it again.');
  }
  return id;
}

export const rethinkAdapter: DeviceAdapter = {
  protocol: 'rethink',
  types: ['ac'],
  simulated: false,

  async prepare(input) {
    const id = typeof input.applianceId === 'string' ? input.applianceId : '';
    if (!id) {
      throw new ApiError('bad_request', 'lg.applianceId is required.');
    }
    if (!isConfigured()) {
      throw new ApiError('not_configured', 'LG appliances are not set up on this backend (RETHINK_MQTT_URL).');
    }
    if (!isConnected()) {
      throw new ApiError('device_unreachable', 'Rethink, the LG bridge, could not be reached.');
    }
    const appliance = getAppliance(id);
    if (!appliance) {
      throw new ApiError('device_not_found', 'Rethink does not know this appliance. Pair it with rethink first.');
    }
    return { config: { applianceId: id }, externalId: id, online: appliance.online, power: appliance.power };
  },

  async setPower(device, power) {
    await setAppliancePower(applianceId(device), power);
  },

  start(report: (report: HardwareReport) => void) {
    // The remote, the unit's own buttons, or the appliance dropping off Wi-Fi.
    applianceEvents.on('change', (id: string) => {
      const appliance = getAppliance(id);
      if (!appliance) {
        return;
      }
      report({
        protocol: 'rethink',
        externalId: id,
        online: appliance.online,
        ...(appliance.power !== 'unknown' ? { power: appliance.power } : {}),
      });
    });
  },
};
