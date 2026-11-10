import { createContext } from 'react';

import type { ParkingActions } from '../services/remote';
import type { ParkingStorage } from '../services/storage.types';
import type { ParkingDb } from '../services/types';

/**
 * What parking screens read (useParking): the backend's parking (ParkingContext.tsx) or, for the demo tools, the
 * offline demo (ParkingDemoContext.tsx). Kept apart from both providers, so the store build, which has only the
 * backend's, never includes the demo's engine and sample data.
 */
export interface ParkingDemoValue {
  /** The demo's own service, or the backend's behind the same methods (ParkingContext.tsx). */
  service: ParkingActions;
  db: ParkingDb;
  /** The clock rules use: real time (plus the demo's offset in the offline demo). */
  now: number;
  /** The signed-in resident. */
  residentId: string;
  /** Where the data lives: the backend (`server`), or this device in the offline demo. */
  storageKind: ParkingStorage['kind'] | 'server';
  /** Base for invitation links: `${inviteOrigin}/pass/<token>`. */
  inviteOrigin: string;
  /** The backend's parking is loaded (always true in the offline demo). */
  status: 'loading' | 'ready' | 'error' | 'no_home';
  error: string | null;
  reload: () => void;
  /** The compound's security desk, when building management has set it. */
  securityPhone: string | null;
  /** A parking screen is open: keep the backend's store fresh until the returned function is called. */
  retain: () => () => void;
}

export const ParkingDemoContext = createContext<ParkingDemoValue | undefined>(undefined);
