import * as SecureStore from 'expo-secure-store';

/**
 * The EMS session token, in the Keychain / Keystore. Readable only while the
 * phone is unlocked, and never restored onto another device from a backup.
 */
const KEY = 'ems.session';
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const sessionStore = {
  load: () => SecureStore.getItemAsync(KEY, OPTIONS).catch(() => null),
  save: (token: string) => SecureStore.setItemAsync(KEY, token, OPTIONS),
  clear: () => SecureStore.deleteItemAsync(KEY, OPTIONS).catch(() => undefined),
};
