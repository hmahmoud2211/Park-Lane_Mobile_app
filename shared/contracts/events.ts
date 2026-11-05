import type { ClinicEvent } from './clinic.ts';
import type { Device, HubStatus, Room } from './home.ts';

/**
 * Messages on the realtime channel, GET /api/events (WebSocket). The client authenticates
 * with its first message, `{ type: 'auth', token }`, and gets `ready` or `error` back; after
 * that the backend pushes changes to the signed-in resident's home.
 */
export type RealtimeEvent =
  | { type: 'ready' }
  | { type: 'device'; device: Device }
  | { type: 'device_removed'; id: string }
  | { type: 'rooms'; rooms: Room[] }
  | { type: 'hub_status'; status: HubStatus; haVersion: string | null }
  | { type: 'accounts' }
  | ({ type: 'clinic' } & ClinicEvent)
  | { type: 'error'; code: string };
