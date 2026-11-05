import { STORAGE_KEY, createMemoryStorage, type ParkingStorage } from './storage.types';

/**
 * Browser persistence in localStorage. Survives a refresh and is shared by
 * tabs of the same browser profile, but never reaches another device: a
 * shared invitation link only works where this data lives.
 */
export function createDeviceStorage(): ParkingStorage {
  let storage: Storage | null = null;
  try {
    storage = typeof window !== 'undefined' ? window.localStorage : null;
    // Private modes can expose the object but refuse writes.
    storage?.setItem(`${STORAGE_KEY}.probe`, '1');
    storage?.removeItem(`${STORAGE_KEY}.probe`);
  } catch {
    storage = null;
  }
  if (!storage) {
    return createMemoryStorage();
  }
  const local = storage;
  return {
    kind: 'browser',
    load: () => local.getItem(STORAGE_KEY),
    save: (serialized) => local.setItem(STORAGE_KEY, serialized),
    clear: () => local.removeItem(STORAGE_KEY),
    subscribe: (onExternalChange) => {
      const listener = (event: StorageEvent) => {
        if (event.key === STORAGE_KEY) {
          onExternalChange();
        }
      };
      window.addEventListener('storage', listener);
      return () => window.removeEventListener('storage', listener);
    },
  };
}
