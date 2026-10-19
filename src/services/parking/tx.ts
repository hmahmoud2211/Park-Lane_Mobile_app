import { newId } from './crypto';
import type { PolicySettings } from './policy';
import type {
  AppNotification,
  AuditActor,
  AuditEvent,
  Entity,
  ParkingDb,
} from './types';

/**
 * A rule the caller broke, with a code the UI can branch on and a message it
 * can show as is. Throwing one inside a transaction discards every change the
 * transaction made.
 */
export class ParkingError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ParkingError';
  }
}

type Collection = {
  [K in keyof ParkingDb]: ParkingDb[K] extends (infer T)[] ? (T extends Entity ? K : never) : never;
}[keyof ParkingDb];

type ItemOf<K extends Collection> = ParkingDb[K] extends (infer T)[] ? T : never;

/**
 * Everything an operation may touch: a private draft of the store and the one
 * clock reading for the whole transaction, so every rule in it agrees on "now".
 */
export interface Tx {
  db: ParkingDb;
  now: number;
  nowIso: string;
  policy: PolicySettings;
  /** Creates a record with id, timestamps and version 1. */
  create<K extends Collection>(collection: K, prefix: string, fields: Omit<ItemOf<K>, keyof Entity>): ItemOf<K>;
  /** Marks a record changed: new `updatedAt`, next `version`. */
  touch(entity: Entity): void;
  get<K extends Collection>(collection: K, id: string | undefined): ItemOf<K>;
  find<K extends Collection>(collection: K, id: string | undefined): ItemOf<K> | undefined;
  audit(actor: AuditActor, action: string, entityType: string, entityId: string, details?: string, reason?: string): void;
  notify(fields: Omit<AppNotification, keyof Entity | 'at'>): void;
}

export function createTx(db: ParkingDb, now: number): Tx {
  const nowIso = new Date(now).toISOString();

  const tx: Tx = {
    db,
    now,
    nowIso,
    policy: db.policy,
    create(collection, prefix, fields) {
      const record = {
        ...fields,
        id: newId(prefix),
        createdAt: nowIso,
        updatedAt: nowIso,
        version: 1,
      } as unknown as ItemOf<typeof collection>;
      (db[collection] as unknown as Entity[]).push(record as unknown as Entity);
      return record;
    },
    touch(entity) {
      entity.updatedAt = nowIso;
      entity.version += 1;
    },
    find(collection, id) {
      if (!id) {
        return undefined;
      }
      return (db[collection] as unknown as Entity[]).find((item) => item.id === id) as
        | ItemOf<typeof collection>
        | undefined;
    },
    get(collection, id) {
      const found = tx.find(collection, id);
      if (!found) {
        throw new ParkingError('not-found', `That ${String(collection).replace(/s$/, '')} no longer exists.`);
      }
      return found;
    },
    audit(actor, action, entityType, entityId, details, reason) {
      tx.create('audit', 'aud', { at: nowIso, actor, action, entityType, entityId, details, reason } as Omit<
        AuditEvent,
        keyof Entity
      >);
    },
    notify(fields) {
      tx.create('notifications', 'ntf', { ...fields, at: nowIso } as Omit<AppNotification, keyof Entity>);
    },
  };
  return tx;
}
