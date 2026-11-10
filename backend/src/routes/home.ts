import { authenticate, requireUser } from '../ems/auth.ts';
import { ApiError } from '../errors.ts';
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
 *   GET  /api/home/scenes                          POST /api/home/scenes/:id/activate
 *   GET  /api/home/automations                     PATCH /api/home/automations/:id { action: enable | disable | run }
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
  // Scenes and automations the installer made in the apartment's Home Assistant (making new ones is a later step).
  if (path === '/api/home/scenes' && method === 'GET') {
    ok(res, runtimeForUser(requireUser(req, HOME_CALLERS).id).listScenes());
    return true;
  }
  if (path === '/api/home/automations' && method === 'GET') {
    ok(res, runtimeForUser(requireUser(req, HOME_CALLERS).id).listAutomations());
    return true;
  }
  const scene = /^\/api\/home\/scenes\/([^/]+)\/activate$/.exec(path);
  if (scene && method === 'POST') {
    const user = requireUser(req);
    throttle('device-command', user.id);
    await runtimeForUser(user.id).runEntity(user.id, decodeURIComponent(scene[1]), 'activate');
    ok(res, { activated: true });
    return true;
  }
  const automation = /^\/api\/home\/automations\/([^/]+)$/.exec(path);
  if (automation && method === 'PATCH') {
    const user = requireUser(req);
    throttle('device-command', user.id);
    const action = (await readJson(req)).action;
    if (action !== 'enable' && action !== 'disable' && action !== 'run') throw new ApiError('invalid', 'Use enable, disable or run.', 'action');
    const runtime = runtimeForUser(user.id);
    await runtime.runEntity(user.id, decodeURIComponent(automation[1]), action);
    ok(res, runtime.listAutomations().find((entry) => entry.id === decodeURIComponent(automation[1])) ?? null);
    return true;
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
