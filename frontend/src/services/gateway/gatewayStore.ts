import * as SecureStore from 'expo-secure-store';

import type { StoredGateway } from './gatewayStore.types';

export type { StoredGateway } from './gatewayStore.types';

/**
 * The gateways this phone is paired with, in the Keychain / Keystore: each
 * one's token and identity key are secrets. One entry per gateway (values
 * stay small, as the secure store prefers) plus an index of their ids.
 * Readable only while the phone is unlocked, never restored onto another
 * device from a backup.
 */
const INDEX_KEY = 'cubegw.index';
const entryKey = (id: string) => `cubegw.${id.replace(/[^A-Za-z0-9._-]/g, '_')}`;
const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

async function readIndex(): Promise<string[]> {
  const raw = await SecureStore.getItemAsync(INDEX_KEY, OPTIONS).catch(() => null);
  try {
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [];
  } catch {
    return [];
  }
}

export const gatewayStore = {
  async load(): Promise<StoredGateway[]> {
    const ids = await readIndex();
    const entries = await Promise.all(
      ids.map(async (id) => {
        const raw = await SecureStore.getItemAsync(entryKey(id), OPTIONS).catch(() => null);
        try {
          return raw ? (JSON.parse(raw) as StoredGateway) : null;
        } catch {
          return null;
        }
      }),
    );
    return entries.filter((entry): entry is StoredGateway => entry !== null && typeof entry.token === 'string');
  },

  async save(gateway: StoredGateway): Promise<void> {
    await SecureStore.setItemAsync(entryKey(gateway.id), JSON.stringify(gateway), OPTIONS);
    const ids = await readIndex();
    if (!ids.includes(gateway.id)) {
      await SecureStore.setItemAsync(INDEX_KEY, JSON.stringify([...ids, gateway.id]), OPTIONS);
    }
  },

  async remove(id: string): Promise<void> {
    await SecureStore.deleteItemAsync(entryKey(id), OPTIONS).catch(() => undefined);
    const ids = await readIndex();
    await SecureStore.setItemAsync(INDEX_KEY, JSON.stringify(ids.filter((entry) => entry !== id)), OPTIONS).catch(() => undefined);
  },
};
