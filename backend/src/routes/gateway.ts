import { authenticate, bearerOf } from '../ems/auth.ts';
import { authenticateGateway, membersFor, passFor, publicKey, revokeSessions } from '../ems/gatewayAccess.ts';
import { sha256 } from '../ems/secrets.ts';
import { readJson } from '../http/body.ts';
import { throttle } from '../http/rateLimits.ts';
import { ok } from '../http/respond.ts';
import type { RouteGroup } from '../http/router.ts';

/**
 * CUBE gateway access through EMS accounts (src/ems/gatewayAccess.ts):
 *   GET  /api/gateway/key        the public key gateways check passes with (open)
 *   POST /api/gateway/pass       a pass for the resident's apartment gateway (app session only)
 *   GET  /api/gateway/members    the unit's residents, roles and signed-in sessions (the gateway, with its secret)
 *   POST /api/gateway/sessions/revoke { sessions }   ends the sessions of phones removed on the gateway (the gateway)
 */
export const gatewayRoutes: RouteGroup = async ({ req, res, path, method }) => {
  if (path === '/api/gateway/key' && method === 'GET') {
    ok(res, publicKey());
    return true;
  }
  if (path === '/api/gateway/pass' && method === 'POST') {
    // The app's own session: an assistant token can't open gateway access.
    const { user } = authenticate(req, ['session']);
    throttle('gateway-pass', user.id);
    ok(res, passFor(user, sha256(bearerOf(req))));
    return true;
  }
  if (path === '/api/gateway/members' && method === 'GET') {
    const gateway = authenticateGateway(req.headers.authorization);
    throttle('gateway-sync', gateway.id);
    ok(res, membersFor(gateway));
    return true;
  }
  if (path === '/api/gateway/sessions/revoke' && method === 'POST') {
    const gateway = authenticateGateway(req.headers.authorization);
    throttle('gateway-sync', gateway.id);
    ok(res, revokeSessions(gateway, (await readJson(req)).sessions));
    return true;
  }
  return false;
};
