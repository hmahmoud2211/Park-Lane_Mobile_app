/**
 * Where the demo store is persisted. A real deployment replaces the whole
 * repository with API calls to a shared backend; this interface only exists
 * so the demo can survive a refresh on one device.
 */
export interface ParkingStorage {
  /** Shown in the demo controls, so nobody mistakes local storage for a server. */
  readonly kind: 'browser' | 'device' | 'memory';
  load(): string | null;
  save(serialized: string): void;
  clear(): void;
  /**
   * Called when another tab of the same browser writes the store, so this
   * tab can reload instead of overwriting newer data.
   */
  subscribe?(onExternalChange: () => void): () => void;
}

export const STORAGE_KEY = 'parklane.parking-demo.v1';

/** For tests and acceptance checks: nothing leaves memory. */
export function createMemoryStorage(initial: string | null = null): ParkingStorage {
  let value = initial;
  return {
    kind: 'memory',
    load: () => value,
    save: (serialized) => {
      value = serialized;
    },
    clear: () => {
      value = null;
    },
  };
}
