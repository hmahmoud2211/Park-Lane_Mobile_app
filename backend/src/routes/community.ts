import {
  adminCommunity,
  adminFeedback,
  answerFeedback,
  cancelEvent,
  closeFeedbackItem,
  closePoll,
  communityFeed,
  createEvent,
  createPoll,
  editAnnouncement,
  editEvent,
  eventAttendees,
  expireAnnouncement,
  myFeedback,
  publishAnnouncement,
  removeAnnouncement,
  removePoll,
  rsvp,
  sendFeedback,
  vote,
} from '../community/community.ts';
import { auditAdmin } from '../ems/adminAudit.ts';
import { requireUser } from '../ems/auth.ts';
import { PICTURES } from '../lib/pictures.ts';
import { readJson } from '../http/body.ts';
import { authorizeAdmin } from '../http/guards.ts';
import { decodeSegment } from '../http/params.ts';
import { throttle } from '../http/rateLimits.ts';
import { ok } from '../http/respond.ts';
import type { RouteGroup } from '../http/router.ts';
import { DEFAULT_SITE_ID } from '../repositories/units.ts';

/**
 * Community (community/community.ts).
 * Residents of the compound:
 *   GET  /api/community                            POST /api/community/events/:id/rsvp { going }
 *   POST /api/community/polls/:id/vote { optionId }      GET | POST /api/community/feedback
 * Building management; `?site=` picks the compound (Park Lane by default):
 *   GET  /api/admin/community
 *   POST /api/admin/community/announcements        PUT | DELETE /api/admin/community/announcements/:id
 *   POST /api/admin/community/announcements/:id/expire
 *   POST /api/admin/community/events               PUT /api/admin/community/events/:id
 *   POST /api/admin/community/events/:id/cancel { note? }    GET /api/admin/community/events/:id/attendees
 *   POST /api/admin/community/polls                POST /api/admin/community/polls/:id/close    DELETE …/polls/:id
 *   GET  /api/admin/community/feedback?status=     POST /api/admin/community/feedback/:id/reply { reply } | /close
 *   GET  /api/admin/pictures                       the pictures the app ships, for notices, events, polls and amenities
 */
export const communityRoutes: RouteGroup = async ({ req, res, path, method, url }) => {
  if (path.startsWith('/api/community')) {
    if (path === '/api/community' && method === 'GET') {
      ok(res, communityFeed(requireUser(req)));
      return true;
    }
    const rsvpRoute = /^\/api\/community\/events\/([^/]+)\/rsvp$/.exec(path);
    if (rsvpRoute && method === 'POST') {
      ok(res, rsvp(requireUser(req), decodeSegment(rsvpRoute[1]), await readJson(req)));
      return true;
    }
    const voteRoute = /^\/api\/community\/polls\/([^/]+)\/vote$/.exec(path);
    if (voteRoute && method === 'POST') {
      ok(res, vote(requireUser(req), decodeSegment(voteRoute[1]), await readJson(req)));
      return true;
    }
    if (path === '/api/community/feedback' && method === 'GET') {
      ok(res, myFeedback(requireUser(req)));
      return true;
    }
    if (path === '/api/community/feedback' && method === 'POST') {
      const user = requireUser(req);
      throttle('feedback', user.id);
      ok(res, sendFeedback(user, await readJson(req)));
      return true;
    }
    return false;
  }

  if (path === '/api/admin/pictures' && method === 'GET') {
    authorizeAdmin(req);
    ok(res, PICTURES);
    return true;
  }
  if (!path.startsWith('/api/admin/community')) return false;
  const { user } = authorizeAdmin(req);
  const site = url.searchParams.get('site') ?? DEFAULT_SITE_ID;
  if (path === '/api/admin/community' && method === 'GET') {
    ok(res, adminCommunity(site));
    return true;
  }
  if (path === '/api/admin/community/announcements' && method === 'POST') {
    const created = publishAnnouncement(user, site, await readJson(req));
    auditAdmin(user, 'announcement.publish', { type: 'announcement', id: created.id }, { kind: created.kind });
    ok(res, created);
    return true;
  }
  const announcement = /^\/api\/admin\/community\/announcements\/([^/]+)(\/expire)?$/.exec(path);
  if (announcement) {
    const id = decodeSegment(announcement[1]);
    const target = { type: 'announcement', id };
    if (announcement[2] && method === 'POST') {
      ok(res, expireAnnouncement(id));
      auditAdmin(user, 'announcement.expire', target);
      return true;
    }
    if (!announcement[2] && method === 'PUT') {
      ok(res, editAnnouncement(id, await readJson(req)));
      auditAdmin(user, 'announcement.edit', target);
      return true;
    }
    if (!announcement[2] && method === 'DELETE') {
      ok(res, removeAnnouncement(id));
      auditAdmin(user, 'announcement.delete', target);
      return true;
    }
    return false;
  }
  if (path === '/api/admin/community/events' && method === 'POST') {
    const created = createEvent(site, await readJson(req));
    auditAdmin(user, 'event.create', { type: 'event', id: created.id });
    ok(res, created);
    return true;
  }
  const event = /^\/api\/admin\/community\/events\/([^/]+)(\/cancel|\/attendees)?$/.exec(path);
  if (event) {
    const id = decodeSegment(event[1]);
    const target = { type: 'event', id };
    if (event[2] === '/attendees' && method === 'GET') {
      ok(res, eventAttendees(id));
      return true;
    }
    if (event[2] === '/cancel' && method === 'POST') {
      ok(res, cancelEvent(id, await readJson(req)));
      auditAdmin(user, 'event.cancel', target);
      return true;
    }
    if (!event[2] && method === 'PUT') {
      ok(res, editEvent(id, await readJson(req)));
      auditAdmin(user, 'event.edit', target);
      return true;
    }
    return false;
  }
  if (path === '/api/admin/community/polls' && method === 'POST') {
    const created = createPoll(site, await readJson(req));
    auditAdmin(user, 'poll.create', { type: 'poll', id: created.id });
    ok(res, created);
    return true;
  }
  const poll = /^\/api\/admin\/community\/polls\/([^/]+)(\/close)?$/.exec(path);
  if (poll) {
    const id = decodeSegment(poll[1]);
    if (poll[2] && method === 'POST') {
      ok(res, closePoll(id));
      auditAdmin(user, 'poll.close', { type: 'poll', id });
      return true;
    }
    if (!poll[2] && method === 'DELETE') {
      ok(res, removePoll(id));
      auditAdmin(user, 'poll.delete', { type: 'poll', id });
      return true;
    }
    return false;
  }
  if (path === '/api/admin/community/feedback' && method === 'GET') {
    ok(res, adminFeedback(site, url.searchParams.get('status')));
    return true;
  }
  const feedback = /^\/api\/admin\/community\/feedback\/([^/]+)\/(reply|close)$/.exec(path);
  if (feedback && method === 'POST') {
    const id = decodeSegment(feedback[1]);
    if (feedback[2] === 'reply') {
      ok(res, answerFeedback(user, id, await readJson(req)));
      auditAdmin(user, 'feedback.reply', { type: 'feedback', id });
    } else {
      ok(res, closeFeedbackItem(id));
      auditAdmin(user, 'feedback.close', { type: 'feedback', id });
    }
    return true;
  }
  return false;
};
