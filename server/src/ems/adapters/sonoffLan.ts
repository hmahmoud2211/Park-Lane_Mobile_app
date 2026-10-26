import { config } from '../../config.ts';
import { ApiError } from '../../errors.ts';
import { browser, discover } from '../../sonoff/bridge.ts';
import { decodeTxt, powerOf, sendSwitch } from '../../sonoff/lanProtocol.ts';
import type { AdapterDevice, DeviceAdapter, HardwareReport } from './types.ts';

/**
 * A SONOFF Wi-Fi plug driven straight over the eWeLink LAN protocol, with no
 * hub or cloud in between. It reuses the bridge's mDNS browser and the LAN
 * encryption in sonoff/lanProtocol.ts (see server/README.md for where that
 * protocol comes from, and what is not verified on the S26R2TPF).
 *
 * Registration is refused unless the plug is announcing itself on this
 * backend's LAN right now, its key decrypts the announcement, and it reports
 * a single switch, so the registry never lists a plug nothing can drive.
 * The address it switches is the one the plug announced, never one a client sent.
 */

const DEVICE_ID = /^[0-9a-f]{10}$/i;

interface PlugConfig {
  deviceId: string;
  deviceKey: string;
  host: string;
  port: number;
  encrypted: boolean;
}

function plugConfig(device: AdapterDevice): PlugConfig {
  const value = device.config as Partial<PlugConfig> | null;
  if (!value?.deviceId || !value.deviceKey || !value.host) {
    throw new ApiError('internal', 'This plug’s settings are incomplete. Remove it and add it again.');
  }
  return value as PlugConfig;
}

const misses = new Map<string, number>();

export const sonoffLanAdapter: DeviceAdapter = {
  protocol: 'sonoff-lan',
  types: ['plug', 'switch', 'light'],
  simulated: false,

  async prepare(input) {
    const deviceId = typeof input.deviceId === 'string' ? input.deviceId.toLowerCase() : '';
    const deviceKey = typeof input.deviceKey === 'string' ? input.deviceKey : '';
    if (!DEVICE_ID.test(deviceId)) {
      throw new ApiError('bad_request', 'sonoff.deviceId must be the plug’s 10-character device ID.');
    }
    if (deviceKey.length < 8 || deviceKey.length > 128) {
      throw new ApiError('bad_request', 'sonoff.deviceKey is not a valid device key.');
    }
    const lan = await discover(deviceId, deviceKey);
    if (!lan) {
      throw new ApiError('device_not_found', 'The plug is not announcing itself on the backend’s network.');
    }
    if (lan.encrypted && lan.keyVerified !== true) {
      throw new ApiError('key_rejected', 'The plug’s key did not decrypt its announcement.');
    }
    if (!lan.singleChannel || lan.power === null) {
      throw new ApiError('unsupported_device', 'The plug does not report a single on/off switch.');
    }
    const plug: PlugConfig = { deviceId, deviceKey, host: lan.host, port: lan.port, encrypted: lan.encrypted };
    return { config: { ...plug }, externalId: deviceId, online: true, power: lan.power };
  },

  async setPower(device, power) {
    const plug = plugConfig(device);
    const result = await sendSwitch(plug, power);
    if (result === 'ok') {
      misses.set(plug.deviceId, 0);
      return;
    }
    throw new ApiError(
      'device_unreachable',
      result === 'rejected' ? 'The plug refused the command.' : 'The plug did not answer on the local network.',
    );
  },

  start(report: (report: HardwareReport) => void, known: () => AdapterDevice[]) {
    if (!browser.listening) {
      return;
    }
    const plugs = () =>
      known()
        .map((device) => device.config as Partial<PlugConfig> | null)
        .filter((plug): plug is PlugConfig => Boolean(plug?.deviceId && plug.deviceKey));

    // The plug's own button, or a new address after a router restart.
    browser.on('service', (service) => {
      const plug = plugs().find((entry) => entry.deviceId === service.deviceId);
      if (!plug) {
        return;
      }
      misses.set(plug.deviceId, 0);
      const power = powerOf(decodeTxt(service.txt, plug.deviceKey).params);
      const port = service.port || config.lan.defaultPort;
      report({
        protocol: 'sonoff-lan',
        externalId: plug.deviceId,
        online: true,
        ...(power ? { power } : {}),
        ...(service.host !== plug.host || port !== plug.port ? { config: { ...plug, host: service.host, port } } : {}),
      });
    });

    // Plugs silent for a few rounds are offline.
    setInterval(() => {
      const watched = plugs();
      if (watched.length === 0) {
        return;
      }
      const startedAt = Date.now();
      browser.query();
      setTimeout(() => {
        for (const plug of watched) {
          if (browser.find(plug.deviceId, startedAt)) {
            continue;
          }
          const missed = (misses.get(plug.deviceId) ?? 0) + 1;
          misses.set(plug.deviceId, missed);
          if (missed === config.mdns.offlineAfterMisses) {
            report({ protocol: 'sonoff-lan', externalId: plug.deviceId, online: false });
          }
        }
      }, config.mdns.queryWindowMs);
    }, config.mdns.monitorIntervalMs).unref();
  },
};
