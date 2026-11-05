import { log } from '../log.ts';

/**
 * Health Passport's background work: reading uploaded documents and making
 * spoken summaries, which take from seconds to minutes. Jobs run in this
 * process, at most CONCURRENCY at a time, in the order asked; asking again
 * for a job already queued or running does nothing. Jobs keep their state in
 * the database, so after a restart index.ts queues the unfinished ones again.
 */

const CONCURRENCY = 2;

const queued = new Map<string, () => Promise<void>>();
const running = new Set<string>();
let idleWaiters: (() => void)[] = [];

export function enqueue(key: string, work: () => Promise<void>): void {
  if (queued.has(key) || running.has(key)) return;
  queued.set(key, work);
  pump();
}

/** Still waiting for a free worker, i.e. not started yet. */
export const isWaiting = (key: string) => queued.has(key);

function pump(): void {
  while (running.size < CONCURRENCY && queued.size > 0) {
    const [key, work] = queued.entries().next().value as [string, () => Promise<void>];
    queued.delete(key);
    running.add(key);
    work()
      .catch((error: unknown) => log.error('Health job failed unexpectedly', { job: key.split(':')[0], reason: (error as Error).message }))
      .finally(() => {
        running.delete(key);
        pump();
      });
  }
  if (queued.size === 0 && running.size === 0) {
    const waiters = idleWaiters;
    idleWaiters = [];
    waiters.forEach((wake) => wake());
  }
}

/** For tests: resolves once every queued and running job has finished. */
export function idle(): Promise<void> {
  if (queued.size === 0 && running.size === 0) return Promise.resolve();
  return new Promise((resolve) => idleWaiters.push(resolve));
}
