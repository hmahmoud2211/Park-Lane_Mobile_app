import { EventEmitter } from 'node:events';

import type { DeviceControls } from './adapters/types.ts';
import type { ApiSmartDevice } from './devices.ts';

/**
 * Changes pushed to a user's open app sessions (see realtime.ts). Every
 * path that changes a device, whether the app, Alexa or the plug's own
 * button, ends here, so clients never need to poll.
 */
export type UserEvent =
  | { type: 'device'; device: ApiSmartDevice }
  /** A device's settings beyond power, or its readings, changed (GET /api/devices/:id/controls). */
  | { type: 'controls'; id: string; controls: DeviceControls }
  | { type: 'device_removed'; id: string }
  | { type: 'alexa'; status: string };

const bus = new EventEmitter<Record<string, [UserEvent]>>();
bus.setMaxListeners(0);

export function publish(userId: string, event: UserEvent): void {
  bus.emit(userId, event);
}

export function subscribe(userId: string, listener: (event: UserEvent) => void): () => void {
  bus.on(userId, listener);
  return () => bus.off(userId, listener);
}
