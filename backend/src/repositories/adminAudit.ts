import { db } from '../ems/db.ts';

/** The admin_audit table: what building management changed, and who. */

export function insertAdminAudit(entry: {
  actorId: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detail: string | null;
  at: string;
}): void {
  db()
    .prepare('INSERT INTO admin_audit (actor_id, action, target_type, target_id, detail, at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(entry.actorId, entry.action, entry.targetType, entry.targetId, entry.detail, entry.at);
}

export function listAdminAudit(targetType: string, targetId: string, limit = 100) {
  return db()
    .prepare('SELECT actor_id, action, detail, at FROM admin_audit WHERE target_type = ? AND target_id = ? ORDER BY id DESC LIMIT ?')
    .all(targetType, targetId, limit) as unknown as { actor_id: string | null; action: string; detail: string | null; at: string }[];
}
