import * as SecureStore from 'expo-secure-store';

/**
 * Secrets on the phone, in the Keychain / Keystore: readable only while the phone is
 * unlocked, and never restored onto another device from a backup. Native only; the web
 * build keeps its secrets for the tab (tabStorage.ts).
 *
 * The keys and these options must never change: a stored session or paired gateway
 * written with others would no longer be found.
 */
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const secureStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key, OPTIONS),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value, OPTIONS),
  deleteItem: (key: string) => SecureStore.deleteItemAsync(key, OPTIONS),
};
