import {
  adminAmenities,
  amenityDay,
  amenityOptions,
  amenitySlots,
  bookAmenity,
  cancelBooking,
  createAmenity,
  editAmenity,
  staffCancelBooking,
  unitBookings,
} from '../amenities/amenities.ts';
import { auditAdmin } from '../ems/adminAudit.ts';
import { requireUser } from '../ems/auth.ts';
import { readJson } from '../http/body.ts';
import { authorizeAdmin } from '../http/guards.ts';
import { decodeSegment } from '../http/params.ts';
import { throttle } from '../http/rateLimits.ts';
import { ok } from '../http/respond.ts';
import type { RouteGroup } from '../http/router.ts';
import { DEFAULT_SITE_ID } from '../repositories/units.ts';

/**
 * Amenities (amenities/amenities.ts).
 * Residents (their own apartment):
 *   GET  /api/amenities                            GET  /api/amenities/:id/slots?date=YYYY-MM-DD
 *   POST /api/amenities/:id/bookings { date, start, people }
 *   GET  /api/amenities/bookings                   POST /api/amenities/bookings/:id/cancel
 * Building management; `?site=` picks the compound (Park Lane by default):
 *   GET | POST /api/admin/amenities                PUT /api/admin/amenities/:id
 *   GET  /api/admin/amenities/:id/bookings?date=   POST /api/admin/amenity-bookings/:id/cancel { note }
 */
export const amenityRoutes: RouteGroup = async ({ req, res, path, method, url }) => {
  if (path.startsWith('/api/amenities')) {
    if (path === '/api/amenities' && method === 'GET') {
      ok(res, amenityOptions(requireUser(req)));
      return true;
    }
    if (path === '/api/amenities/bookings' && method === 'GET') {
      ok(res, unitBookings(requireUser(req)));
      return true;
    }
    const cancel = /^\/api\/amenities\/bookings\/([^/]+)\/cancel$/.exec(path);
    if (cancel && method === 'POST') {
      ok(res, cancelBooking(requireUser(req), decodeSegment(cancel[1])));
      return true;
    }
    const slots = /^\/api\/amenities\/([^/]+)\/slots$/.exec(path);
    if (slots && method === 'GET') {
      ok(res, amenitySlots(requireUser(req), decodeSegment(slots[1]), url.searchParams.get('date')));
      return true;
    }
    const book = /^\/api\/amenities\/([^/]+)\/bookings$/.exec(path);
    if (book && method === 'POST') {
      const user = requireUser(req);
      throttle('amenity-booking', user.id);
      ok(res, bookAmenity(user, decodeSegment(book[1]), await readJson(req)));
      return true;
    }
    return false;
  }

  if (!path.startsWith('/api/admin/amenities') && !path.startsWith('/api/admin/amenity-bookings/')) return false;
  const { user } = authorizeAdmin(req);
  const site = url.searchParams.get('site') ?? DEFAULT_SITE_ID;
  if (path === '/api/admin/amenities' && method === 'GET') {
    ok(res, adminAmenities(site));
    return true;
  }
  if (path === '/api/admin/amenities' && method === 'POST') {
    const created = createAmenity(site, await readJson(req));
    auditAdmin(user, 'amenity.create', { type: 'amenity', id: created.id });
    ok(res, created);
    return true;
  }
  const amenity = /^\/api\/admin\/amenities\/([^/]+)(\/bookings)?$/.exec(path);
  if (amenity) {
    const id = decodeSegment(amenity[1]);
    if (amenity[2] && method === 'GET') {
      ok(res, amenityDay(id, url.searchParams.get('date')));
      return true;
    }
    if (!amenity[2] && method === 'PUT') {
      const updated = editAmenity(id, await readJson(req));
      auditAdmin(user, 'amenity.edit', { type: 'amenity', id }, { active: updated.active });
      ok(res, updated);
      return true;
    }
    return false;
  }
  const staffCancel = /^\/api\/admin\/amenity-bookings\/([^/]+)\/cancel$/.exec(path);
  if (staffCancel && method === 'POST') {
    const id = decodeSegment(staffCancel[1]);
    ok(res, staffCancelBooking(id, await readJson(req)));
    auditAdmin(user, 'amenity_booking.cancel', { type: 'amenity_booking', id });
    return true;
  }
  return false;
};
