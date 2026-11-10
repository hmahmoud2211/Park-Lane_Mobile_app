import { auditAdmin } from '../ems/adminAudit.ts';
import { bearerOf, lookupToken, requireUser } from '../ems/auth.ts';
import { ApiError } from '../errors.ts';
import { linkValid, publicBase } from '../health/files.ts';
import { readBytes, readJson } from '../http/body.ts';
import { authorizeAdmin } from '../http/guards.ts';
import { decodeSegment } from '../http/params.ts';
import { throttle } from '../http/rateLimits.ts';
import { ok, sendBytes } from '../http/respond.ts';
import type { RouteGroup } from '../http/router.ts';
import { DEFAULT_SITE_ID } from '../repositories/units.ts';
import {
  MAX_PHOTO_BYTES,
  addRequestPhoto,
  addTechnician,
  adminCategories,
  adminRequests,
  assignRequest,
  cancelRequest,
  createRequest,
  editTechnician,
  listRequests,
  memberMayOpenPhoto,
  photoFile,
  requestOptions,
  residentComment,
  setRequestStatus,
  staffComment,
  technicians,
  toggleCategory,
} from '../requests/serviceRequests.ts';

/**
 * Maintenance, housekeeping and moving requests (requests/serviceRequests.ts).
 * Residents (their own unit):
 *   GET  /api/requests/options?kind=               GET | POST /api/requests
 *   POST /api/requests/:id/cancel                  POST /api/requests/:id/comments { note }
 *   POST /api/requests/:id/photos  (a JPEG or PNG as the body)
 *   GET  /api/requests/photos/:id/file             (a unit member or admin, or a signed link)
 * Building management; `?site=` picks the compound (Park Lane by default):
 *   GET  /api/admin/requests?status=open|…&kind=   POST /api/admin/requests/:id/assign { technicianId, scheduledDate, scheduledWindow, note? }
 *   POST /api/admin/requests/:id/status { status, note? }      POST /api/admin/requests/:id/comments { note }
 *   GET | POST /api/admin/technicians              PUT /api/admin/technicians/:id
 *   GET  /api/admin/service-categories             PUT /api/admin/service-categories/:kind/:id { active }
 */
export const requestRoutes: RouteGroup = async ({ req, res, path, method, url }) => {
  if (path.startsWith('/api/requests')) {
    const photo = /^\/api\/requests\/photos\/([^/]+)\/file$/.exec(path);
    if (photo && method === 'GET') {
      const id = decodeSegment(photo[1]);
      const session = lookupToken(bearerOf(req), ['session']);
      if (!linkValid(path, url) && !(session && memberMayOpenPhoto(session.user, id))) throw new ApiError('not_found', 'Not found.');
      const found = photoFile(id);
      if (!found) throw new ApiError('not_found', 'Not found.');
      sendBytes(res, found.mime, found.bytes);
      return true;
    }
    if (path === '/api/requests/options' && method === 'GET') {
      ok(res, requestOptions(requireUser(req), url.searchParams.get('kind') ?? undefined));
      return true;
    }
    if (path === '/api/requests' && method === 'GET') {
      ok(res, listRequests(requireUser(req), publicBase(req)));
      return true;
    }
    if (path === '/api/requests' && method === 'POST') {
      const user = requireUser(req);
      throttle('service-request', user.id);
      ok(res, createRequest(user, await readJson(req), publicBase(req)));
      return true;
    }
    const action = /^\/api\/requests\/([^/]+)\/(cancel|comments|photos)$/.exec(path);
    if (action && method === 'POST') {
      const user = requireUser(req);
      const id = decodeSegment(action[1]);
      if (action[2] === 'cancel') ok(res, cancelRequest(user, id, publicBase(req)));
      else if (action[2] === 'comments') {
        throttle('request-comment', user.id);
        ok(res, residentComment(user, id, await readJson(req), publicBase(req)));
      } else {
        throttle('request-photo', user.id);
        ok(res, addRequestPhoto(user, id, await readBytes(req, MAX_PHOTO_BYTES), publicBase(req)));
      }
      return true;
    }
    return false;
  }

  if (!path.startsWith('/api/admin/requests') && !path.startsWith('/api/admin/technicians') && !path.startsWith('/api/admin/service-categories')) return false;
  const { user } = authorizeAdmin(req);
  const site = url.searchParams.get('site') ?? DEFAULT_SITE_ID;

  if (path === '/api/admin/requests' && method === 'GET') {
    ok(res, adminRequests(site, url.searchParams, publicBase(req)));
    return true;
  }
  const requestAction = /^\/api\/admin\/requests\/([^/]+)\/(assign|status|comments)$/.exec(path);
  if (requestAction && method === 'POST') {
    const id = decodeSegment(requestAction[1]);
    const body = await readJson(req);
    const target = { type: 'service_request', id };
    if (requestAction[2] === 'assign') {
      const updated = assignRequest(user, id, body, publicBase(req));
      auditAdmin(user, 'request.assign', target, { technician: updated.technicianId, date: updated.scheduledDate });
      ok(res, updated);
    } else if (requestAction[2] === 'status') {
      const updated = setRequestStatus(user, id, body, publicBase(req));
      auditAdmin(user, 'request.status', target, { status: updated.status });
      ok(res, updated);
    } else {
      throttle('request-comment', user?.id ?? 'api-key');
      ok(res, staffComment(user, id, body, publicBase(req)));
    }
    return true;
  }
  if (path === '/api/admin/technicians' && method === 'GET') {
    ok(res, technicians(site));
    return true;
  }
  if (path === '/api/admin/technicians' && method === 'POST') {
    const created = addTechnician(site, await readJson(req));
    auditAdmin(user, 'technician.add', { type: 'technician', id: created.id });
    ok(res, created);
    return true;
  }
  const technician = /^\/api\/admin\/technicians\/([^/]+)$/.exec(path);
  if (technician && method === 'PUT') {
    const id = decodeSegment(technician[1]);
    const updated = editTechnician(id, await readJson(req));
    auditAdmin(user, 'technician.edit', { type: 'technician', id }, { active: updated.active });
    ok(res, updated);
    return true;
  }
  if (path === '/api/admin/service-categories' && method === 'GET') {
    ok(res, adminCategories(site));
    return true;
  }
  const category = /^\/api\/admin\/service-categories\/([^/]+)\/([^/]+)$/.exec(path);
  if (category && method === 'PUT') {
    const kind = decodeSegment(category[1]);
    const id = decodeSegment(category[2]);
    const updated = toggleCategory(site, kind, id, await readJson(req));
    auditAdmin(user, 'service_category.toggle', { type: 'service_category', id: `${kind}:${id}` }, { active: updated.active });
    ok(res, updated);
    return true;
  }
  return false;
};
