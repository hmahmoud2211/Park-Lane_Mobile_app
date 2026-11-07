import { createServer, type Server } from 'node:http';

import { serveAdmin } from './admin/serve.ts';
import { attachRealtime } from './ems/realtime.ts';
import { ApiError } from './errors.ts';
import { oauthCallback } from './ha/accounts.ts';
import { OAUTH_BASE_PATH } from './ha/haRest.ts';
import { logAccess } from './http/accessLog.ts';
import { contextOf, type RequestContext } from './http/context.ts';
import { applyCors } from './http/cors.ts';
import { sendError } from './http/errorHandler.ts';
import { redirect } from './http/respond.ts';
import { dispatch, type RouteGroup } from './http/router.ts';
import { accountRoutes } from './routes/accounts.ts';
import { authRoutes } from './routes/auth.ts';
import { clinicRoutes } from './routes/clinic.ts';
import { gatewayRoutes } from './routes/gateway.ts';
import { healthRoutes } from './routes/health.ts';
import { homeRoutes } from './routes/home.ts';
import { opsRoutes } from './routes/ops.ts';
import { unitRoutes } from './routes/unit.ts';

/**
 * The Parklane / EMS device backend: one HTTP server for the REST API and the realtime
 * WebSocket (GET /api/events, ems/realtime.ts). The routes live in routes/, each file
 * listing its own; docs/API_DOCUMENTATION.md describes them all.
 *
 * Every answer carries CORS headers and is `{ ok: true, data }` or
 * `{ ok: false, error: { code, message } }`. A known path asked with a method it does not
 * take is a 404, like an unknown path (test/routing.test.ts pins this).
 */

/** Tried in order. Their paths do not overlap, so the order only matters for speed. */
const API_ROUTES: readonly RouteGroup[] = [authRoutes, homeRoutes, accountRoutes, clinicRoutes, gatewayRoutes, unitRoutes, opsRoutes];

async function route(ctx: RequestContext) {
  // Brand sign-in pages send the browser here; it carries no EMS token, the hub checks the state.
  if (ctx.path === `${OAUTH_BASE_PATH}/auth/external/callback` && ctx.req.method === 'GET') {
    redirect(ctx.res, await oauthCallback(ctx.url));
    return;
  }
  // Building management's dashboard: static files; everything it does goes through /api/admin/*.
  if ((ctx.path === '/admin' || ctx.path.startsWith('/admin/')) && serveAdmin(ctx.path, ctx.req.method, ctx.res)) {
    return;
  }
  if (ctx.path.startsWith('/api/') && (await dispatch(ctx, API_ROUTES))) {
    return;
  }
  // Health Passport keeps its own /health/ paths and answers, as the app's client expects.
  if (await healthRoutes(ctx)) {
    return;
  }
  throw new ApiError('not_found', 'Not found.');
}

export function createApp(): Server {
  const server = createServer((req, res) => {
    const startedAt = Date.now();
    const ctx = contextOf(req, res);

    applyCors(res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204).end();
      return;
    }

    route(ctx)
      .catch((error: unknown) => sendError(res, error, ctx.path))
      .finally(() => logAccess(req.method, ctx.path, res.statusCode, startedAt));
  });
  attachRealtime(server);
  return server;
}
