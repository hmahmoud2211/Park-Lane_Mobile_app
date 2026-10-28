import { isHealthError } from './healthService';

export interface PollSchedule {
  fastIntervalMs: number;
  fastForMs: number;
  slowIntervalMs: number;
  giveUpAfterMs: number;
}

/**
 * Wait before the next status check of a job started `elapsedMs` ago, or
 * null once it has run too long to keep asking.
 */
export function nextPollDelay(elapsedMs: number, schedule: PollSchedule): number | null {
  if (elapsedMs >= schedule.giveUpAfterMs) return null;
  const interval = elapsedMs < schedule.fastForMs ? schedule.fastIntervalMs : schedule.slowIntervalMs;
  return Math.min(interval, schedule.giveUpAfterMs - elapsedMs);
}

type TimerHandle = ReturnType<typeof setTimeout>;

export interface StatusPollerOptions<T> {
  /** Reads the job's current state, e.g. a document or a summary. */
  fetch: (key: string) => Promise<T>;
  /** Still running, so worth asking again. */
  isPending: (value: T) => boolean;
  /** Every answer, so lists and badges stay current. */
  onUpdate: (value: T, key: string) => void;
  /** The job finished: done, or failed. */
  onSettled: (value: T, key: string) => void;
  /** Still running after the give-up time; checks stop until asked again. */
  onGiveUp: (key: string) => void;
  schedule: PollSchedule;
  now?: () => number;
  setTimer?: (run: () => void, ms: number) => TimerHandle;
  clearTimer?: (handle: TimerHandle) => void;
}

interface Tracked {
  startedAt: number;
  timer: TimerHandle | null;
  inFlight: boolean;
}

/**
 * Follows jobs the server runs in the background: documents being read and
 * summaries being made. Checks run only while the app is in the foreground:
 * going to the background stops every timer, and coming back checks each
 * job at once, then resumes the schedule. The jobs carry on on the server
 * either way.
 */
export class StatusPoller<T> {
  private readonly tracked = new Map<string, Tracked>();
  private foreground = true;
  private readonly now: () => number;
  private readonly setTimer: (run: () => void, ms: number) => TimerHandle;
  private readonly clearTimer: (handle: TimerHandle) => void;

  constructor(private readonly options: StatusPollerOptions<T>) {
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? ((run, ms) => setTimeout(run, ms));
    this.clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));
  }

  /** Starts following a job; `startedAt` is when it began, so a reopened app keeps the same deadline. */
  track(key: string, startedAt = this.now()) {
    if (this.tracked.has(key)) return;
    this.tracked.set(key, { startedAt, timer: null, inFlight: false });
    this.schedule(key);
  }

  /** Begins the schedule again, e.g. after "Taking longer than expected". */
  restart(key: string) {
    this.untrack(key);
    this.track(key);
  }

  untrack(key: string) {
    const entry = this.tracked.get(key);
    if (entry?.timer) this.clearTimer(entry.timer);
    this.tracked.delete(key);
  }

  isTracking(key: string) {
    return this.tracked.has(key);
  }

  get size() {
    return this.tracked.size;
  }

  setForeground(active: boolean) {
    if (active === this.foreground) return;
    this.foreground = active;
    for (const [key, entry] of this.tracked) {
      if (entry.timer) {
        this.clearTimer(entry.timer);
        entry.timer = null;
      }
      if (active) void this.check(key);
    }
  }

  clear() {
    for (const key of [...this.tracked.keys()]) this.untrack(key);
  }

  private schedule(key: string) {
    const entry = this.tracked.get(key);
    if (!entry || !this.foreground) return;
    const delay = nextPollDelay(this.now() - entry.startedAt, this.options.schedule);
    if (delay === null) {
      this.untrack(key);
      this.options.onGiveUp(key);
      return;
    }
    entry.timer = this.setTimer(() => {
      entry.timer = null;
      void this.check(key);
    }, delay);
  }

  private async check(key: string) {
    const entry = this.tracked.get(key);
    if (!entry || entry.inFlight) return;
    entry.inFlight = true;
    try {
      const value = await this.options.fetch(key);
      if (!this.tracked.has(key)) return;
      this.options.onUpdate(value, key);
      if (!this.options.isPending(value)) {
        this.untrack(key);
        this.options.onSettled(value, key);
        return;
      }
    } catch (error) {
      // Gone, or signed out: nothing more to ask. A dropped connection or a busy server is tried again.
      if (isHealthError(error) && (error.kind === 'not_found' || error.kind === 'unauthorized')) {
        this.untrack(key);
        return;
      }
    } finally {
      entry.inFlight = false;
    }
    this.schedule(key);
  }
}
