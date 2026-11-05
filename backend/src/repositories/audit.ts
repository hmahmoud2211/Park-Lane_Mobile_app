import { db } from '../ems/db.ts';

/** The audit_log table: sensitive commands (unlocking) and every command the Parklane Assistant sends. */
export function recordAudit(entry: { userId: string; hubId: string; action: string; target: string; via: string | null; at: string }): void {
  db()
    .prepare('INSERT INTO audit_log (user_id, hub_id, action, target, via, at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(entry.userId, entry.hubId, entry.action, entry.target, entry.via, entry.at);
}
