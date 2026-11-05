import { db } from '../ems/db.ts';

/**
 * The pairing_sessions table: brand-linking flows in progress, so a flow id is only ever
 * stepped by the resident who started it, on their own hub, until it expires.
 */

export interface PairingSessionRow {
  flow_id: string;
  hub_id: string;
  user_id: string;
  handler: string;
  fields: string | null;
}

/** Starts or extends a session, and clears expired ones. */
export function saveSession(flowId: string, hubId: string, userId: string, handler: string, now: number, expiresAt: number): void {
  db()
    .prepare(
      `INSERT INTO pairing_sessions (flow_id, hub_id, user_id, handler, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(flow_id) DO UPDATE SET expires_at = excluded.expires_at`,
    )
    .run(flowId, hubId, userId, handler, now, expiresAt);
  db().prepare('DELETE FROM pairing_sessions WHERE expires_at < ?').run(now);
}

export function findLiveSession(flowId: string, now: number): PairingSessionRow | undefined {
  return db()
    .prepare('SELECT flow_id, hub_id, user_id, handler, fields FROM pairing_sessions WHERE flow_id = ? AND expires_at > ?')
    .get(flowId, now) as PairingSessionRow | undefined;
}

/** The hub of a live session, for the brand's OAuth callback (which carries no EMS token). */
export function findLiveSessionHub(flowId: string, now: number): string | undefined {
  const row = db().prepare('SELECT hub_id FROM pairing_sessions WHERE flow_id = ? AND expires_at > ?').get(flowId, now) as
    | { hub_id: string }
    | undefined;
  return row?.hub_id;
}

/** The form's field names and sections, JSON, so the next answer can be nested the same way. */
export function setSessionFields(flowId: string, fields: string): void {
  db().prepare('UPDATE pairing_sessions SET fields = ? WHERE flow_id = ?').run(fields, flowId);
}

export function deleteSession(flowId: string): void {
  db().prepare('DELETE FROM pairing_sessions WHERE flow_id = ?').run(flowId);
}
