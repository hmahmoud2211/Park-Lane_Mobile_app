import { secureStorage } from '../../../lib/storage/secureStorage';
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

async function readIndex(): Promise<string[]> {
  const raw = await secureStorage.getItem(INDEX_KEY).catch(() => null);
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
        const raw = await secureStorage.getItem(entryKey(id)).catch(() => null);
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
    await secureStorage.setItem(entryKey(gateway.id), JSON.stringify(gateway));
    const ids = await readIndex();
    if (!ids.includes(gateway.id)) {
      await secureStorage.setItem(INDEX_KEY, JSON.stringify([...ids, gateway.id]));
    }
  },

  async remove(id: string): Promise<void> {
    await secureStorage.deleteItem(entryKey(id)).catch(() => undefined);
    const ids = await readIndex();
    await secureStorage.setItem(INDEX_KEY, JSON.stringify(ids.filter((entry) => entry !== id))).catch(() => undefined);
  },
};
