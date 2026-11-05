import { authenticate, requireUser } from '../ems/auth.ts';
import { parseCommand } from '../ha/commands.ts';
import { homeFor } from '../ha/home.ts';
import { runtimeForUser } from '../ha/hubs.ts';
import { readJson } from '../http/body.ts';
import { HOME_CALLERS } from '../http/guards.ts';
import { throttle } from '../http/rateLimits.ts';
import { ok } from '../http/respond.ts';
import type { RouteGroup } from '../http/router.ts';

/**
 * The resident's home, served from their unit's Home Assistant (src/ha/):
 *   GET  /api/home
 *   GET  /api/devices                              GET | PATCH /api/devices/:id
 *   POST /api/devices/:id/commands { capability, action, value?, entityId? }
 *   GET  /api/rooms                                POST /api/rooms { name }
 *
 * An assistant token reaches only the reads above and device commands, never
 * unlocks a door, and every command it sends is audited. Renaming devices and
 * creating rooms need the app's own session.
 */
export const homeRoutes: RouteGroup = async ({ req, res, path, method }) => {
  if (path === '/api/home' && method === 'GET') {
    ok(res, homeFor(requireUser(req, HOME_CALLERS).id));
    return true;
  }
  if (path === '/api/devices' && method === 'GET') {
    ok(res, runtimeForUser(requireUser(req, HOME_CALLERS).id).listDevices());
    return true;
  }
  const device = /^\/api\/devices\/([^/]+)(\/commands)?$/.exec(path);
  if (device) {
    // Renaming and moving devices stay with the app.
    const { user, kind } = authenticate(req, method === 'PATCH' ? ['session'] : HOME_CALLERS);
    const id = decodeURIComponent(device[1]);
    if (device[2] && method === 'POST') {
      throttle('device-command', user.id);
      const command = parseCommand(await readJson(req));
      ok(res, await runtimeForUser(user.id).command(user.id, id, command, kind === 'assistant' ? 'assistant' : 'app'));
      return true;
    }
    if (!device[2] && method === 'GET') {
      ok(res, runtimeForUser(user.id).getDevice(id));
      return true;
    }
    if (!device[2] && method === 'PATCH') {
      const body = await readJson(req);
      ok(res, await runtimeForUser(user.id).updateDevice(id, { name: body.name, roomId: body.roomId }));
      return true;
    }
  }
  if (path === '/api/rooms') {
    const user = requireUser(req, method === 'GET' ? HOME_CALLERS : ['session']);
    if (method === 'GET') {
      ok(res, runtimeForUser(user.id).listRooms());
      return true;
    }
    if (method === 'POST') {
      throttle('room-create', user.id);
      ok(res, await runtimeForUser(user.id).createRoom((await readJson(req)).name));
      return true;
    }
  }
  return false;
};
