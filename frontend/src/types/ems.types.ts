import type { RealtimeEvent } from '../../../shared/contracts/events';
import type { User } from '../../../shared/contracts/auth';

/** The EMS backend's accounts and realtime channel, as the app sees them (backend/ in this repo). */

export type EmsUser = User;

export type RealtimeState = 'offline' | 'connecting' | 'live';

/** Messages on the backend's realtime channel (shared/contracts/events.ts). */
export type EmsEvent = RealtimeEvent;
