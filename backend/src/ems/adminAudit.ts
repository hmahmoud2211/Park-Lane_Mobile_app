import { insertAdminAudit } from '../repositories/adminAudit.ts';
import type { User } from './auth.ts';

/** Records a change building management made. `actor` is null for the shared ADMIN_API_KEY. Never put secrets in `detail`. */
export function auditAdmin(actor: User | null, action: string, target: { type: string; id: string } | null, detail?: Record<string, unknown>): void {
  insertAdminAudit({
    actorId: actor?.id ?? null,
    action,
    targetType: target?.type ?? null,
    targetId: target?.id ?? null,
    detail: detail ? JSON.stringify(detail) : null,
    at: new Date().toISOString(),
  });
}
