/**
 * The demo's persistent store.
 *
 * Atomicity: every write runs through `transact`, which
 *   1. waits its turn in a single queue (writes never interleave),
 *   2. reloads the persisted copy (picks up another tab's commit),
 *   3. runs the operation on a private draft with one clock reading,
 *   4. commits the draft and persists it only if nothing threw.
 * So a booking's availability check and its insert form one step: two
 * simultaneous confirmations run one after the other, and the second sees
 * the first's booking and is refused. A failed edit throws before commit and
 * the original booking is untouched.
 *
 * Limitations, by design of a demo: browser tabs share localStorage without
 * a lock, so two tabs committing in the same instant can still race. A real
 * deployment replaces this class with a server using database transactions
 * plus an exclusion constraint on (space, time range), e.g. PostgreSQL
 * `EXCLUDE USING gist (space_id WITH =, tstzrange(start, end, '[)') WITH &&)`.
 */
import { createSeed, SCHEMA_VERSION } from './seed';
import { runScheduledRules } from './scheduler';
import type { ParkingStorage } from './storage.types';
import { createTx, type Tx } from './tx';
import type { ParkingDb } from './types';

type Listener = () => void;

export class ParkingRepository {
  private db: ParkingDb;
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<Listener>();
  private unsubscribeStorage?: () => void;

  constructor(
    private readonly storage: ParkingStorage,
    /** Real time source; the demo clock is this plus the stored offset. */
    private readonly realNow: () => number = Date.now,
  ) {
    this.db = this.loadOrSeed();
    this.unsubscribeStorage = storage.subscribe?.(() => {
      const external = this.readPersisted();
      if (external && external.revision !== this.db.revision) {
        this.db = external;
        this.emit();
      }
    });
  }

  get storageKind() {
    return this.storage.kind;
  }

  /** The committed store. Treat as read-only; change it through `transact`. */
  get snapshot(): ParkingDb {
    return this.db;
  }

  /** The one clock every rule uses: real time shifted by the demo offset. */
  now(): number {
    return this.realNow() + this.db.clockOffsetMs;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose() {
    this.unsubscribeStorage?.();
    this.listeners.clear();
  }

  /**
   * Runs `operation` atomically against the latest data. The scheduled rules
   * run first, so every decision sees expiries and overstays that fell due,
   * even while the app was closed.
   */
  transact<T>(operation: (tx: Tx) => T): Promise<T> {
    const run = async () => {
      const latest = this.readPersisted() ?? this.db;
      const before = JSON.stringify(latest);
      const draft = JSON.parse(before) as ParkingDb;
      const tx = createTx(draft, this.realNow() + draft.clockOffsetMs);
      runScheduledRules(tx);
      const result = operation(tx);
      if (JSON.stringify(draft) === before) {
        // Nothing changed (e.g. a quiet tick): no write, no re-render.
        if (latest !== this.db) {
          this.db = latest;
          this.emit();
        }
        return result;
      }
      draft.revision = latest.revision + 1;
      this.commit(draft);
      return result;
    };
    const next = this.queue.then(run, run);
    // Keep the queue alive after a rejected operation.
    this.queue = next.catch(() => undefined);
    return next;
  }

  /** Applies due rules (no-shows, overdue, charging) without other changes. */
  tick(): Promise<void> {
    return this.transact(() => undefined);
  }

  /** Moves the demo clock. Everything time-based is re-evaluated at once. */
  advanceClock(byMs: number): Promise<void> {
    return this.transact((tx) => {
      tx.db.clockOffsetMs += byMs;
    }).then(() => this.tick());
  }

  /** Replaces everything with fresh seed data at the real current time. */
  reset(): Promise<void> {
    const run = async () => {
      const seeded = createSeed(this.realNow());
      seeded.revision = this.db.revision + 1;
      this.commit(seeded);
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private commit(next: ParkingDb) {
    this.storage.save(JSON.stringify(next));
    this.db = next;
    this.emit();
  }

  private emit() {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private readPersisted(): ParkingDb | null {
    try {
      const raw = this.storage.load();
      if (!raw) return null;
      const parsed = JSON.parse(raw) as ParkingDb;
      return parsed.schemaVersion === SCHEMA_VERSION ? parsed : null;
    } catch {
      return null;
    }
  }

  private loadOrSeed(): ParkingDb {
    const stored = this.readPersisted();
    if (stored) {
      return stored;
    }
    const seeded = createSeed(this.realNow());
    this.storage.save(JSON.stringify(seeded));
    return seeded;
  }
}
