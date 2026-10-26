import type { Device, HubStatus, Room } from './home.types';

/** The EMS backend's accounts and realtime channel, as the app sees them (server/ in this repo). */

export interface EmsUser {
  id: string;
  email: string;
  name: string;
}

export type RealtimeState = 'offline' | 'connecting' | 'live';

export type EmsEvent =
  | { type: 'ready' }
  | { type: 'device'; device: Device }
  | { type: 'device_removed'; id: string }
  | { type: 'rooms'; rooms: Room[] }
  | { type: 'hub_status'; status: HubStatus; haVersion: string | null }
  | { type: 'error'; code: string };
