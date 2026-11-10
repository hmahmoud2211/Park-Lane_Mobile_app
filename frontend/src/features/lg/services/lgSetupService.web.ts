import { LgSetupError, type SetupProtocol, type SetupRequest } from './lgSetupProtocol';

/** The web build has no raw TLS sockets, so it cannot run an LG appliance's setup. */
export const isLgSetupAvailable = () => false;

export async function sendWifiToAppliance(
  _ssid: string,
  _password: string,
  _servers: SetupRequest['servers'] = null,
): Promise<SetupProtocol> {
  throw new LgSetupError('unreachable', 'Setting up LG appliances needs the Parklane phone app.');
}
