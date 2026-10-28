import { ApiError } from '../../errors.ts';
import {
  applianceControls,
  applianceEvents,
  getAppliance,
  isConfigured,
  isConnected,
  setApplianceControl,
  setAppliancePower,
} from '../../rethink/appliances.ts';
import type { AdapterDevice, DeviceAdapter, HardwareReport } from './types.ts';

/**
 * An LG appliance paired with rethink, the local stand-in for LG's ThinQ
 * cloud (see rethink/appliances.ts and docker/rethink). Power, and every
 * setting rethink announces for the model (mode, set point, fan, swing,
 * Jet, timers, filter), each resolving once the appliance reported it back.
 */

/** Rethink publishes a burst of topics at a time; each appliance reports once per burst. */
const REPORT_DELAY_MS = 200;

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

  readControls(device) {
    return applianceControls(applianceId(device));
  },

  async setControl(device, key, value) {
    await setApplianceControl(applianceId(device), key, value);
  },

  start(report: (report: HardwareReport) => void) {
    // The remote, the unit's own buttons, a new reading, or the appliance dropping off Wi-Fi.
    const due = new Set<string>();
    let timer: NodeJS.Timeout | undefined;
    const flush = () => {
      timer = undefined;
      const ids = [...due];
      due.clear();
      for (const id of ids) {
        const appliance = getAppliance(id);
        if (!appliance) {
          continue;
        }
        report({
          protocol: 'rethink',
          externalId: id,
          online: appliance.online,
          ...(appliance.power !== 'unknown' ? { power: appliance.power } : {}),
          controlsChanged: true,
        });
      }
    };
    applianceEvents.on('change', (id: string) => {
      due.add(id);
      timer ??= setTimeout(flush, REPORT_DELAY_MS);
    });
  },
};
