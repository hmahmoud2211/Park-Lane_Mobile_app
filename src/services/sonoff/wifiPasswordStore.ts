import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

/**
 * Home Wi-Fi passwords the resident chose to remember, so pairing the next
 * plug fills them in. Phones never let apps read saved Wi-Fi passwords, so
 * this only holds what was typed here. Kept in the Keychain / Keystore,
 * readable only while the phone is unlocked and never restored to another
 * phone; keyed by a hash of the network name (store keys allow few characters).
 */
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

async function keyFor(ssid: string): Promise<string> {
  const digest = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, ssid);
  return `wifi.${digest.slice(0, 40)}`;
}

export const wifiPasswordStore = {
  available: true,
  load: async (ssid: string) => SecureStore.getItemAsync(await keyFor(ssid), OPTIONS).catch(() => null),
  save: async (ssid: string, password: string) => SecureStore.setItemAsync(await keyFor(ssid), password, OPTIONS).catch(() => undefined),
  forget: async (ssid: string) => SecureStore.deleteItemAsync(await keyFor(ssid), OPTIONS).catch(() => undefined),
};
