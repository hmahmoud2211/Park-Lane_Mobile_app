import { File, Paths } from 'expo-file-system';

import { STORAGE_KEY, type ParkingStorage } from './storage.types';

/**
 * Native persistence: one JSON file in the app's document directory. Writes
 * are synchronous, so a committed transaction is on disk before the next one
 * starts. Data stays on this device only.
 */
export function createDeviceStorage(): ParkingStorage {
  const file = new File(Paths.document, `${STORAGE_KEY}.json`);
  return {
    kind: 'device',
    load: () => {
      try {
        return file.exists ? file.textSync() : null;
      } catch {
        return null;
      }
    },
    save: (serialized) => {
      if (!file.exists) {
        file.create();
      }
      file.write(serialized);
    },
    clear: () => {
      if (file.exists) {
        file.delete();
      }
    },
  };
}
