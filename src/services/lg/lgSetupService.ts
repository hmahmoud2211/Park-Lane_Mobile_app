import { NativeModules, Platform } from 'react-native';
import TcpSocket from 'react-native-tcp-socket';

import { lgConfig } from '../../constants/lgConfig';
import { unbindFromDeviceNetwork } from '../sonoff/wifiProvisioningService';
import { LgSetupError, provisionLgAppliance, type SetupProtocol, type SetupSocket } from './lgSetupProtocol';

/**
 * The phone's side of LG pairing: TLS sockets to the appliance over
 * react-native-tcp-socket (native, so missing from Expo Go and the web
 * build). Hotspot names and passwords are in lgHotspot.
 */

/** True in a development or store build with the socket module linked. */
export function isLgSetupAvailable(): boolean {
  return Platform.OS !== 'web' && NativeModules.TcpSockets != null;
}

function openTls(host: string, port: number): Promise<SetupSocket> {
  return new Promise((resolve, reject) => {
    const socket = TcpSocket.connectTLS(
      {
        host,
        port,
        // Android: through the hotspot even while mobile data has the internet. This binds the
        // whole app to the hotspot; sendWifiToAppliance undoes it.
        interface: 'wifi',
        connectTimeout: lgConfig.connectTimeoutMs,
        // The appliance's certificate is LG's own; there is nothing to check it against.
        rejectUnauthorized: false,
      } as Parameters<typeof TcpSocket.connectTLS>[0],
      () => {
        socket.removeListener('error', reject);
        resolve({
          write: (bytes) => socket.write(bytes),
          onData: (listener) =>
            socket.on('data', (data) => listener(typeof data === 'string' ? new TextEncoder().encode(data) : data)),
          onClose: (listener) => {
            let error: Error | undefined;
            socket.on('error', (cause) => {
              error = cause;
            });
            socket.once('close', () => listener(error));
          },
          destroy: () => socket.destroy(),
        });
      },
    );
    socket.once('error', reject);
  });
}

/**
 * Sends the home Wi-Fi to the appliance whose hotspot the phone is on.
 * Tries each address an appliance may have on its hotspot, moving on only
 * when nothing answers there.
 */
export async function sendWifiToAppliance(ssid: string, password: string): Promise<SetupProtocol> {
  if (!isLgSetupAvailable()) {
    throw new LgSetupError('unreachable', 'This build cannot talk to LG appliances. Install the latest Parklane build.');
  }
  const request = { ssid, password, utcOffsetMinutes: -new Date().getTimezoneOffset() };
  let lastError: unknown;
  try {
    for (const host of lgConfig.apHosts) {
      try {
        return await provisionLgAppliance((port) => openTls(host, port), request, lgConfig.replyTimeoutMs);
      } catch (error) {
        lastError = error;
        if (!(error instanceof LgSetupError) || error.kind !== 'unreachable') {
          throw error;
        }
      }
    }
    throw lastError;
  } finally {
    // The sockets bound the whole app to the hotspot, which the AC is about to take down.
    await unbindFromDeviceNetwork();
  }
}
