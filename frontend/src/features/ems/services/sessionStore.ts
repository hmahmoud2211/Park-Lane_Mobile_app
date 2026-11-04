import { secureStorage } from '../../../lib/storage/secureStorage';

/**
 * The EMS session token, in the Keychain / Keystore (lib/storage/secureStorage):
 * readable only while the phone is unlocked, never restored onto another device.
 */
const KEY = 'ems.session';

export const sessionStore = {
  load: () => secureStorage.getItem(KEY).catch(() => null),
  save: (token: string) => secureStorage.setItem(KEY, token),
  clear: () => secureStorage.deleteItem(KEY).catch(() => undefined),
};
