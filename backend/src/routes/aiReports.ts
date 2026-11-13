import { adminAiReports, reviewAiReport, submitAiReport } from '../aiReports/aiReports.ts';
import { auditAdmin } from '../ems/adminAudit.ts';
import { bearerOf, lookupToken } from '../ems/auth.ts';
import { clientIp } from '../ems/rateLimit.ts';
import { readJson } from '../http/body.ts';
import { authorizeAdmin } from '../http/guards.ts';
import { decodeSegment } from '../http/params.ts';
import { throttle } from '../http/rateLimits.ts';
import { ok } from '../http/respond.ts';
import type { RouteGroup } from '../http/router.ts';

/** A 4000-character excerpt in Arabic, with a note, can pass the 16 KB default once escaped. */
const REPORT_BODY_BYTES = 32 * 1024;

/**
 * Reports of AI-generated content (aiReports/aiReports.ts).
 * Anyone, signed in or a guest:
 *   POST /api/ai-reports { source, reason, note?, excerpt }   -> { id, receivedAt }
 * Building management:
 *   GET  /api/admin/ai-reports?status=new|reviewed           POST /api/admin/ai-reports/:id/reviewed
 *
 * Sign-in is optional. A live session attaches the report to that account and apartment. A token that is missing,
 * expired or revoked is treated as a guest, never refused: the report is then not linked to anyone, so no one is
 * named who could not be checked, and a report of harmful content is not lost because a sign-in ran out.
 */
export const aiReportRoutes: RouteGroup = async ({ req, res, path, method, url }) => {
  if (path === '/api/ai-reports' && method === 'POST') {
    const user = lookupToken(bearerOf(req), ['session'])?.user ?? null;
    const ip = clientIp(req);
    throttle('ai-report-ip', ip);
    throttle('ai-report', user ? `user:${user.id}` : `ip:${ip}`);
    ok(res, submitAiReport(user, await readJson(req, REPORT_BODY_BYTES)));
    return true;
  }

  if (path !== '/api/admin/ai-reports' && !path.startsWith('/api/admin/ai-reports/')) return false;
  const { user } = authorizeAdmin(req);
  if (path === '/api/admin/ai-reports' && method === 'GET') {
    ok(res, adminAiReports(url.searchParams.get('status')));
    return true;
  }
  const reviewed = /^\/api\/admin\/ai-reports\/([^/]+)\/reviewed$/.exec(path);
  if (reviewed && method === 'POST') {
    const id = decodeSegment(reviewed[1]);
    ok(res, reviewAiReport(id));
    auditAdmin(user, 'ai-report.review', { type: 'ai_report', id });
    return true;
  }
  return false;
};
