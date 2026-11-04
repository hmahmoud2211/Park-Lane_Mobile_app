/**
 * Demo only: a pass link that carries its own booking.
 *
 * Without a shared server, a guest's phone has no copy of the booking, so
 * the invitation link also carries what the pass needs: the guest's name,
 * the time, the bay, the plate, the reference and the QR code. The guest's
 * phone rebuilds the pass from that and from the site plan, which every copy
 * of the app ships with.
 *
 * Limits, said plainly on the pass: anyone could write such a link (nothing
 * signs it), and later changes by the host never reach it. A production
 * build drops this and looks the invitation up on the server.
 */
import { reservationView, type ReservationView } from './selectors';
import { iso } from './time';
import type { ParkingDb, Reservation } from './types';

const VERSION = 1;

/** What the link carries. Times are epoch milliseconds. */
export interface PassSnapshot {
  name: string;
  start: number;
  end: number;
  spaceId: string;
  reference: string;
  plate?: string;
  /** The QR code's content: the gate credential. */
  token: string;
  /** EV bookings: the charging slot, connector and charger. */
  charging?: { start: number; end: number; connector: string; chargerId: string };
}

/* ---------------------------------------------- base64url, UTF-8 safe */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function utf8Bytes(text: string): number[] {
  const bytes: number[] = [];
  const escaped = encodeURIComponent(text);
  for (let i = 0; i < escaped.length; i++) {
    if (escaped[i] === '%') {
      bytes.push(parseInt(escaped.slice(i + 1, i + 3), 16));
      i += 2;
    } else {
      bytes.push(escaped.charCodeAt(i));
    }
  }
  return bytes;
}

function toBase64Url(text: string): string {
  const bytes = utf8Bytes(text);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += ALPHABET[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += ALPHABET[n & 63];
  }
  return out;
}

function fromBase64Url(encoded: string): string | null {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const ch of encoded) {
    const value = ALPHABET.indexOf(ch);
    if (value < 0) return null;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 255);
    }
  }
  try {
    return decodeURIComponent(bytes.map((b) => `%${b.toString(16).padStart(2, '0')}`).join(''));
  } catch {
    return null;
  }
}

/* ------------------------------------------------------- Encode, decode */

/** The `d` value for a booking's pass link. */
export function encodePassSnapshot(view: ReservationView): string | undefined {
  const r = view.reservation;
  if (!view.credential) return undefined;
  const payload = [
    VERSION,
    r.guest?.name ?? '',
    Date.parse(r.scheduledStart),
    Date.parse(r.scheduledEnd),
    r.spaceId,
    r.reference,
    r.vehiclePlate ?? '',
    view.credential.displayToken,
    view.allocation && view.connector
      ? [Date.parse(view.allocation.start), Date.parse(view.allocation.end), view.connector.type, view.allocation.chargerId]
      : 0,
  ];
  return toBase64Url(JSON.stringify(payload));
}

/** Reads a link's `d` value; null if it is damaged or names a bay this site does not have. */
export function decodePassSnapshot(encoded: string | undefined, db: ParkingDb): PassSnapshot | null {
  if (!encoded) return null;
  const json = fromBase64Url(encoded);
  if (!json) return null;
  try {
    const p: unknown = JSON.parse(json);
    if (!Array.isArray(p) || p[0] !== VERSION) return null;
    const [, name, start, end, spaceId, reference, plate, token, charging] = p as [
      number, string, number, number, string, string, string, string, [number, number, string, string] | 0,
    ];
    const valid =
      typeof name === 'string' &&
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      end > start &&
      typeof token === 'string' &&
      token.length > 0 &&
      db.spaces.some((s) => s.id === spaceId);
    if (!valid) return null;
    return {
      name,
      start,
      end,
      spaceId,
      reference: String(reference),
      plate: plate || undefined,
      token,
      charging: Array.isArray(charging)
        ? { start: charging[0], end: charging[1], connector: charging[2], chargerId: charging[3] }
        : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * The pass view rebuilt from a link: the bay, zone, gate, building and route
 * come from the site plan; the rest from the link. Read-only.
 */
export function snapshotView(db: ParkingDb, snap: PassSnapshot, now: number): ReservationView {
  const stamp = iso(snap.start);
  const reservation: Reservation = {
    id: `link-${snap.reference}`,
    createdAt: stamp,
    updatedAt: stamp,
    version: 1,
    reference: snap.reference,
    propertyId: db.properties[0]?.id ?? '',
    residentId: '',
    bookedFor: 'guest',
    guest: { name: snap.name },
    vehiclePlate: snap.plate,
    parkingType: snap.charging ? 'ev' : 'standard',
    spaceId: snap.spaceId,
    status: now > snap.end ? 'completed' : 'confirmed',
    scheduledStart: iso(snap.start),
    scheduledEnd: iso(snap.end),
    invitationId: '',
    credentialId: '',
  };
  const view = reservationView(db, reservation, now);
  return {
    ...view,
    credential: {
      id: `link-${snap.reference}`,
      createdAt: stamp,
      updatedAt: stamp,
      version: 1,
      reservationId: reservation.id,
      tokenHash: '',
      displayToken: snap.token,
      status: now > snap.end ? 'consumed' : 'active',
      issuedAt: stamp,
    },
  };
}
