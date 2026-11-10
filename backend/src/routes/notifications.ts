import { requireUser } from '../ems/auth.ts';
import { inbox, markInboxRead, prefsOf, updatePrefs } from '../ems/notifications.ts';
import { readJson } from '../http/body.ts';
import { ok } from '../http/respond.ts';
import type { RouteGroup } from '../http/router.ts';

/**
 * The signed-in person's inbox:
 *   GET /api/notifications?before=&limit=        POST /api/notifications/read { ids } | { all: true }
 *   GET /api/notifications/prefs                 PUT  /api/notifications/prefs { <kind>: boolean }
 */
export const notificationRoutes: RouteGroup = async ({ req, res, path, method, url }) => {
  if (!path.startsWith('/api/notifications')) return false;
  if (path === '/api/notifications' && method === 'GET') {
    ok(res, inbox(requireUser(req).id, url.searchParams));
    return true;
  }
  if (path === '/api/notifications/read' && method === 'POST') {
    const user = requireUser(req);
    ok(res, markInboxRead(user.id, await readJson(req)));
    return true;
  }
  if (path === '/api/notifications/prefs' && method === 'GET') {
    ok(res, prefsOf(requireUser(req).id));
    return true;
  }
  if (path === '/api/notifications/prefs' && method === 'PUT') {
    const user = requireUser(req);
    ok(res, updatePrefs(user.id, await readJson(req)));
    return true;
  }
  return false;
};
