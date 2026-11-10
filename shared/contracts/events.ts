import type { ClinicEvent } from './clinic.ts';
import type { Device, HubStatus, Room } from './home.ts';
import type { NotificationEvent } from './notifications.ts';

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
  | NotificationEvent
  /** A visitor pass of the resident's unit was made, cancelled, or used at the gate: refetch the list. */
  | { type: 'visitor.updated'; passId: string }
  /** A parcel for the resident's unit arrived or was handed over. */
  | { type: 'parcel.updated'; parcelId: string }
  /** A maintenance, housekeeping or moving request of the resident's unit changed. */
  | { type: 'request.updated'; requestId: string }
  /** Management published or changed community news, an event or a poll: refetch GET /api/community. */
  | { type: 'community.updated' }
  /** A booking on that amenity was made or cancelled: open slot lists should be refetched. */
  | { type: 'amenity.updated'; amenityId: string }
  /** Something in the compound's parking changed (a booking, a gate scan, a charger): refetch the parking snapshot. */
  | { type: 'parking.updated' }
  /** A new quarter-hour reading of the compound's building systems is current: refetch GET /api/sites/me/bms/latest. */
  | { type: 'bms.reading'; at: string }
  /** A new quarter-hour reading of the apartment's energy is current. */
  | { type: 'energy.reading'; at: string }
  | { type: 'error'; code: string };
