import { EventEmitter } from 'node:events';

/**
 * Changes pushed to a user's open app sessions (see realtime.ts), so
 * clients never need to poll.
 */
export interface UserEvent {
  type: string;
  [field: string]: unknown;
}

const bus = new EventEmitter<Record<string, [UserEvent]>>();
bus.setMaxListeners(0);

export function publish(userId: string, event: UserEvent): void {
  bus.emit(userId, event);
}

export function subscribe(userId: string, listener: (event: UserEvent) => void): () => void {
  bus.on(userId, listener);
  return () => bus.off(userId, listener);
}
