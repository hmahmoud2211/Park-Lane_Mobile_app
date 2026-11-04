import { requireUser } from '../ems/auth.ts';
import {
  cancelFlow,
  getFlow,
  listAccounts,
  reconnectAccount,
  refreshAccounts,
  reloadAccount,
  removeAccount,
  startFlow,
  stepFlow,
} from '../ha/accounts.ts';
import { listIntegrations } from '../ha/integrations.ts';
import { readJson } from '../http/body.ts';
import { throttle } from '../http/rateLimits.ts';
import { ok } from '../http/respond.ts';
import type { RouteGroup } from '../http/router.ts';

/**
 * Linking brand accounts (Home Assistant config flows on the unit's hub), all with the
 * app's session:
 *   GET  /api/accounts/integrations                GET /api/accounts
 *   POST /api/accounts/flows { integration }       GET | POST { data } | DELETE /api/accounts/flows/:id
 *   POST /api/accounts/:id/reconnect | /reload     DELETE /api/accounts/:id
 *   POST /api/accounts/refresh                     (reloads every account: picks up devices added in brand apps)
 *
 * The brands' OAuth callback, which carries no EMS token, is routed in app.ts.
 */
export const accountRoutes: RouteGroup = async ({ req, res, path, method }) => {
  if (path === '/api/accounts/integrations' && method === 'GET') {
    requireUser(req);
    ok(res, listIntegrations());
    return true;
  }
  if (path === '/api/accounts' && method === 'GET') {
    ok(res, await listAccounts(requireUser(req).id));
    return true;
  }
  if (path === '/api/accounts/flows' && method === 'POST') {
    const user = requireUser(req);
    throttle('account-flow', user.id);
    ok(res, await startFlow(user.id, (await readJson(req)).integration));
    return true;
  }
  const flow = /^\/api\/accounts\/flows\/([^/]+)$/.exec(path);
  if (flow) {
    const user = requireUser(req);
    const flowId = decodeURIComponent(flow[1]);
    if (method === 'GET') {
      ok(res, await getFlow(user.id, flowId));
      return true;
    }
    if (method === 'POST') {
      throttle('account-flow-step', user.id);
      ok(res, await stepFlow(user.id, flowId, (await readJson(req)).data));
      return true;
    }
    if (method === 'DELETE') {
      await cancelFlow(user.id, flowId);
      ok(res, { cancelled: true });
      return true;
    }
  }
  if (path === '/api/accounts/refresh' && method === 'POST') {
    const user = requireUser(req);
    throttle('account-refresh', user.id);
    ok(res, await refreshAccounts(user.id));
    return true;
  }
  const account = /^\/api\/accounts\/([^/]+?)(\/reconnect|\/reload)?$/.exec(path);
  if (account && account[1] !== 'flows' && account[1] !== 'integrations' && account[1] !== 'refresh') {
    const user = requireUser(req);
    const accountId = decodeURIComponent(account[1]);
    if (account[2] === '/reconnect' && method === 'POST') {
      ok(res, { step: await reconnectAccount(user.id, accountId) });
      return true;
    }
    if (account[2] === '/reload' && method === 'POST') {
      await reloadAccount(user.id, accountId);
      ok(res, { reloaded: true });
      return true;
    }
    if (!account[2] && method === 'DELETE') {
      await removeAccount(user.id, accountId);
      ok(res, { removed: true });
      return true;
    }
  }
  return false;
};
