import type { HealthLang } from './health.types';
import { HealthError } from './healthService';

export interface Resource<T> {
  data: T | undefined;
  error: HealthError | null;
  loading: boolean;
  /** Something changed on the server; mounted screens fetch it again. */
  stale: boolean;
}

/**
 * An in-app notification: a document finished reading (or couldn't be
 * read), or a summary the resident asked for is ready (or failed).
 */
interface NoticeBase {
  id: string;
  /** The job it is about: a document id, or a summary's job key. */
  key: string;
  profileId: string;
  at: number;
}

export type HealthNotice =
  | (NoticeBase & { kind: 'ready' | 'failed'; docId: string })
  | (NoticeBase & { kind: 'summary_ready' | 'summary_failed'; lang: HealthLang; specialty: string | null });

/** Distributes over the union, so each kind keeps its own fields. */
type NewNotice = HealthNotice extends infer N ? (N extends HealthNotice ? Omit<N, 'id'> : never) : never;

export interface HealthState {
  resources: Readonly<Record<string, Resource<unknown>>>;
  notices: readonly HealthNotice[];
  /** Jobs (documents, summaries) still running after the poller gave up. */
  slowJobs: readonly string[];
}

export const healthKeys = {
  consent: 'consent',
  profiles: 'profiles',
  record: (profileId: string) => `record:${profileId}`,
  documents: (profileId: string) => `documents:${profileId}`,
  document: (docId: string) => `document:${docId}`,
  /** One specialty's summary, or without one the newest in that language. */
  summary: (profileId: string, lang: HealthLang, specialty?: string | null) =>
    `summary:${profileId}:${lang}:${specialty ?? '*'}`,
  /** All of a profile's summaries, to mark them out of date together. */
  summaries: (profileId: string) => `summary:${profileId}:`,
};

/** The poller's name for a summary job; the specialty is the one the server answered with. */
export const summaryJobKey = (profileId: string, lang: HealthLang, specialty: string | null) =>
  `${profileId}|${lang}|${specialty ?? ''}`;

export function parseSummaryJobKey(key: string) {
  const [profileId, lang, specialty] = key.split('|');
  return { profileId, lang: lang as HealthLang, specialty: specialty || null };
}

const EMPTY: Resource<never> = { data: undefined, error: null, loading: false, stale: false };

const asHealthError = (error: unknown) =>
  error instanceof HealthError ? error : new HealthError('server', 'Unexpected error.');

/**
 * Health Passport's cache, in memory only: nothing medical is written to
 * the device. `clear` empties it, and runs when the resident signs out or
 * the session ends.
 */
export class HealthStore {
  private state: HealthState = { resources: {}, notices: [], slowJobs: [] };
  /** Summary jobs the resident started or watched, so only those raise a banner when done. */
  private readonly watched = new Set<string>();
  private readonly listeners = new Set<() => void>();
  private readonly inFlight = new Map<string, Promise<unknown>>();
  /** Bumped by `clear`, so answers to requests made before it are dropped. */
  private generation = 0;
  private noticeCount = 0;

  getSnapshot = () => this.state;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private commit(next: Partial<HealthState>) {
    this.state = { ...this.state, ...next };
    this.listeners.forEach((listener) => listener());
  }

  resource<T>(key: string): Resource<T> {
    return (this.state.resources[key] as Resource<T> | undefined) ?? EMPTY;
  }

  private put(key: string, patch: Partial<Resource<unknown>>) {
    const current = this.resource(key);
    this.commit({ resources: { ...this.state.resources, [key]: { ...current, ...patch } } });
  }

  /** Fetches `key` once, however many screens ask at the same time. */
  load<T>(key: string, fetcher: () => Promise<T>): Promise<T | undefined> {
    const existing = this.inFlight.get(key);
    if (existing) return existing as Promise<T | undefined>;
    const generation = this.generation;
    this.put(key, { loading: true });
    const run = fetcher()
      .then(
        (data) => {
          if (generation === this.generation) this.put(key, { data, error: null, loading: false, stale: false });
          return data;
        },
        (error: unknown) => {
          if (generation === this.generation) this.put(key, { error: asHealthError(error), loading: false, stale: false });
          return undefined;
        },
      )
      .finally(() => {
        if (this.inFlight.get(key) === run) this.inFlight.delete(key);
      });
    this.inFlight.set(key, run);
    return run;
  }

  set<T>(key: string, data: T) {
    this.put(key, { data, error: null, loading: false, stale: false });
  }

  update<T>(key: string, change: (current: T) => T) {
    const current = this.resource<T>(key).data;
    if (current !== undefined) this.set(key, change(current));
  }

  remove(key: string) {
    const { [key]: _gone, ...rest } = this.state.resources;
    this.commit({ resources: rest });
  }

  /** Marks every key starting with one of `prefixes` as out of date. */
  invalidate(...prefixes: string[]) {
    const resources: Record<string, Resource<unknown>> = { ...this.state.resources };
    let changed = false;
    for (const key of Object.keys(resources)) {
      if (prefixes.some((prefix) => key === prefix || key.startsWith(prefix))) {
        resources[key] = { ...resources[key], stale: true };
        changed = true;
      }
    }
    if (changed) this.commit({ resources });
  }

  pushNotice(notice: NewNotice) {
    this.noticeCount += 1;
    const others = this.state.notices.filter((n) => n.key !== notice.key);
    this.commit({ notices: [...others, { ...notice, id: `n-${this.noticeCount}` } as HealthNotice] });
  }

  dismissNotice(id: string) {
    this.commit({ notices: this.state.notices.filter((n) => n.id !== id) });
  }

  dismissNoticesFor(key: string) {
    if (this.state.notices.some((n) => n.key === key)) {
      this.commit({ notices: this.state.notices.filter((n) => n.key !== key) });
    }
  }

  setSlow(key: string, slow: boolean) {
    const others = this.state.slowJobs.filter((id) => id !== key);
    if (slow === this.state.slowJobs.includes(key)) return;
    this.commit({ slowJobs: slow ? [...others, key] : others });
  }

  watch(jobKey: string) {
    this.watched.add(jobKey);
  }

  /** Whether a banner is owed for this job; asking once clears it. */
  takeWatched(jobKey: string) {
    return this.watched.delete(jobKey);
  }

  clear() {
    this.generation += 1;
    this.inFlight.clear();
    this.watched.clear();
    this.commit({ resources: {}, notices: [], slowJobs: [] });
  }
}
