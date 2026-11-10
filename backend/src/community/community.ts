import { randomUUID } from 'node:crypto';

import type {
  AdminFeedbackView,
  AnnouncementView,
  CommunityEventView,
  CommunityFeed,
  FeedbackTopic,
  FeedbackView,
  PollView,
  RsvpState,
} from '../../../shared/contracts/community.ts';
import type { User } from '../ems/auth.ts';
import { publishToSite } from '../ems/broadcast.ts';
import { transaction } from '../ems/db.ts';
import { notify } from '../ems/notifications.ts';
import { seal, unseal } from '../ems/secrets.ts';
import { requireSite, requireSiteById, requireUnit } from '../ems/sites.ts';
import { ApiError } from '../errors.ts';
import { pictureOf } from '../lib/pictures.ts';
import {
  closeFeedback,
  closePollAt,
  deleteAnnouncement,
  deletePoll,
  deleteRsvp,
  findAnnouncement,
  findEvent,
  findFeedback,
  findPoll,
  insertFeedback,
  insertPoll,
  insertRsvp,
  listAllAnnouncements,
  listLiveAnnouncements,
  listPollOptions,
  listPolls,
  listRecentEvents,
  listSiteFeedback,
  listUpcomingEvents,
  listUserFeedback,
  myRsvps,
  myVotes,
  replyToFeedback,
  rsvpCounts,
  rsvpList,
  rsvpUserIds,
  saveAnnouncement,
  saveEvent,
  upsertVote,
  voteCounts,
  type AnnouncementRow,
  type EventRow,
  type FeedbackRow,
  type PollOptionRow,
  type PollRow,
} from '../repositories/community.ts';
import { memberIdsOfSite } from '../repositories/units.ts';

/**
 * Community: building management publishes notices and alerts, events and polls; residents of the compound read
 * them, register for events (within the capacity), vote once per poll (and may change it until it closes), and
 * send feedback, which management answers. New notices, events and polls go to residents' inboxes (kind
 * `community`, which they can turn off); a change to an event, or its cancellation, goes to those registered.
 */

const TOPICS: readonly FeedbackTopic[] = ['suggestion', 'concern', 'compliment', 'other'];
const MAX_POLL_DAYS = 90;

function invalid(field: string, message: string): never {
  throw new ApiError('invalid', message, field);
}

function text(value: unknown, field: string, min: number, max: number, what: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed.length < min || trimmed.length > max) invalid(field, `${what}: ${min} to ${max} characters.`);
  return trimmed;
}

function optionalText(value: unknown, field: string, max: number): string | null {
  if (value === undefined || value === null || value === '') return null;
  return text(value, field, 1, max, 'Keep it short');
}

function instant(value: unknown, field: string): string {
  const ms = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  if (Number.isNaN(ms)) invalid(field, 'Give a date and time.');
  return new Date(ms).toISOString();
}

const optionalInstant = (value: unknown, field: string) => (value === undefined || value === null || value === '' ? null : instant(value, field));

const tellSite = (siteId: string) => publishToSite(siteId, { type: 'community.updated' });

// ---- presenting ---------------------------------------------------------------------------------------

function presentAnnouncement(row: AnnouncementRow): AnnouncementView {
  return {
    id: row.id,
    kind: row.kind,
    level: row.level,
    title: row.title,
    body: row.body,
    fullText: row.full_text,
    picture: row.picture,
    publishedAt: row.published_at,
    expiresAt: row.expires_at,
  };
}

function rsvpState(row: EventRow, going: number, mine: boolean, now: string): RsvpState {
  if (mine) return 'going';
  if (row.cancelled_at) return 'closed';
  if (row.rsvp_opens_at && now < row.rsvp_opens_at) return 'soon';
  if ((row.rsvp_until ?? row.starts_at) <= now) return 'closed';
  if (row.capacity !== null && going >= row.capacity) return 'full';
  return 'open';
}

function presentEvents(rows: readonly EventRow[], userId: string | null, now: string): CommunityEventView[] {
  const ids = rows.map((row) => row.id);
  const counts = rsvpCounts(ids);
  const mine = userId ? myRsvps(userId, ids) : new Set<string>();
  return rows.map((row) => {
    const going = counts.get(row.id) ?? 0;
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      startsAt: row.starts_at,
      endsAt: row.ends_at,
      venue: row.venue,
      picture: row.picture,
      capacity: row.capacity,
      going,
      rsvp: rsvpState(row, going, mine.has(row.id), now),
      rsvpOpensAt: row.rsvp_opens_at,
      rsvpUntil: row.rsvp_until,
      cancelled: row.cancelled_at !== null,
    };
  });
}

function presentPolls(rows: readonly PollRow[], userId: string | null, now: string): PollView[] {
  const ids = rows.map((row) => row.id);
  const options = listPollOptions(ids);
  const counts = voteCounts(ids);
  const mine = userId ? myVotes(userId, ids) : new Map<string, string>();
  return rows.map((row) => {
    const own = options.filter((option) => option.poll_id === row.id).map((option) => ({ id: option.id, label: option.label, picture: option.picture, votes: counts.get(option.id) ?? 0 }));
    const open = row.opens_at <= now && now < row.closes_at;
    return {
      id: row.id,
      question: row.question,
      opensAt: row.opens_at,
      closesAt: row.closes_at,
      options: own,
      totalVotes: own.reduce((sum, option) => sum + option.votes, 0),
      myVote: mine.get(row.id) ?? null,
      open,
    };
  });
}

function presentFeedback(row: FeedbackRow): FeedbackView {
  return {
    id: row.id,
    topic: row.topic,
    message: unseal(row.message),
    status: row.status,
    reply: row.reply ? unseal(row.reply) : null,
    repliedAt: row.replied_at,
    createdAt: row.created_at,
  };
}

// ---- residents ----------------------------------------------------------------------------------------

export function communityFeed(user: User, nowMs = Date.now()): CommunityFeed {
  requireUnit(user);
  const site = requireSite(user);
  const now = new Date(nowMs).toISOString();
  const live = listLiveAnnouncements(site.id, now).map(presentAnnouncement);
  const polls = presentPolls(listPolls(site.id, 12), user.id, now);
  const current = polls.filter((poll) => poll.open).sort((a, b) => b.opensAt.localeCompare(a.opensAt))[0] ?? null;
  return {
    announcements: live.filter((item) => item.kind === 'news'),
    alerts: live.filter((item) => item.kind === 'alert'),
    events: presentEvents(listUpcomingEvents(site.id, now), user.id, now),
    poll: current,
    pastPolls: polls.filter((poll) => poll.closesAt <= now).slice(0, 5),
    timezone: site.timezone,
  };
}

function siteEvent(user: User, eventId: string): EventRow {
  const site = requireSite(user);
  requireUnit(user);
  const row = findEvent(eventId);
  if (!row || row.site_id !== site.id) throw new ApiError('not_found', 'No such event.');
  return row;
}

/** Registers or unregisters the resident. Places are counted inside the transaction, so the last place goes once. */
export function rsvp(user: User, eventId: string, body: Record<string, unknown>, nowMs = Date.now()): CommunityEventView {
  const row = siteEvent(user, eventId);
  const now = new Date(nowMs).toISOString();
  if (typeof body.going !== 'boolean') invalid('going', 'Use true or false.');
  if (body.going) {
    transaction(() => {
      const going = rsvpCounts([row.id]).get(row.id) ?? 0;
      const state = rsvpState(row, going, myRsvps(user.id, [row.id]).has(row.id), now);
      if (state === 'going') return;
      if (state === 'full') throw new ApiError('conflict', 'No places are left.');
      if (state !== 'open') throw new ApiError('invalid_transition', state === 'soon' ? 'Registration has not opened yet.' : 'Registration has closed.');
      insertRsvp(row.id, user.id, now);
    });
  } else {
    if (row.starts_at <= now) throw new ApiError('invalid_transition', 'The event has started.');
    deleteRsvp(row.id, user.id);
  }
  return presentEvents([row], user.id, now)[0];
}

export function vote(user: User, pollId: string, body: Record<string, unknown>, nowMs = Date.now()): PollView {
  const site = requireSite(user);
  requireUnit(user);
  const poll = findPoll(pollId);
  if (!poll || poll.site_id !== site.id) throw new ApiError('not_found', 'No such poll.');
  const now = new Date(nowMs).toISOString();
  if (!(poll.opens_at <= now && now < poll.closes_at)) throw new ApiError('invalid_transition', 'This poll is closed.');
  const option = listPollOptions([poll.id]).find((entry) => entry.id === body.optionId);
  if (!option) invalid('optionId', 'Choose one of the options.');
  upsertVote(poll.id, user.id, option.id, now);
  return presentPolls([poll], user.id, now)[0];
}

export function sendFeedback(user: User, body: Record<string, unknown>, nowMs = Date.now()): FeedbackView {
  const unit = requireUnit(user);
  const site = requireSite(user);
  const topic = TOPICS.includes(body.topic as FeedbackTopic) ? (body.topic as FeedbackTopic) : invalid('topic', 'Choose a topic.');
  const message = text(body.message, 'message', 10, 500, 'Write your message');
  const at = new Date(nowMs).toISOString();
  const row: FeedbackRow = {
    id: randomUUID(), site_id: site.id, unit_id: unit.id, user_id: user.id, topic, message: seal(message), status: 'new',
    reply: null, replied_by: null, replied_at: null, created_at: at, updated_at: at,
  };
  insertFeedback(row);
  return presentFeedback(row);
}

export const myFeedback = (user: User): FeedbackView[] => listUserFeedback(user.id).map(presentFeedback);

// ---- building management ------------------------------------------------------------------------------

export function adminCommunity(siteId: string, nowMs = Date.now()) {
  const site = requireSiteById(siteId);
  const now = new Date(nowMs).toISOString();
  const events = listRecentEvents(site.id, new Date(nowMs - 30 * 86_400_000).toISOString());
  return {
    announcements: listAllAnnouncements(site.id).map(presentAnnouncement),
    events: presentEvents(events, null, now),
    polls: presentPolls(listPolls(site.id, 20), null, now),
  };
}

function announcementFields(body: Record<string, unknown>, nowMs: number) {
  const kind = body.kind === 'alert' ? 'alert' : body.kind === 'news' ? 'news' : invalid('kind', 'Use news or alert.');
  const level = body.level === 'warning' ? 'warning' : body.level === 'info' || body.level === undefined ? 'info' : invalid('level', 'Use info or warning.');
  const expiresAt = optionalInstant(body.expiresAt, 'expiresAt');
  if (expiresAt && Date.parse(expiresAt) <= nowMs) invalid('expiresAt', 'Choose a time in the future.');
  return {
    kind,
    level,
    title: text(body.title, 'title', 3, 80, 'Title'),
    body: text(body.body, 'body', 3, 300, 'Summary'),
    full_text: optionalText(body.fullText, 'fullText', 2000),
    picture: pictureOf(body.picture, 'picture'),
    expires_at: expiresAt,
  } as const;
}

/** Publishes a notice now (residents are told), or edits one (they aren't told again). */
export function publishAnnouncement(staff: User | null, siteId: string, body: Record<string, unknown>, nowMs = Date.now()): AnnouncementView {
  const site = requireSiteById(siteId);
  const at = new Date(nowMs).toISOString();
  const row: AnnouncementRow = { id: randomUUID(), site_id: site.id, ...announcementFields(body, nowMs), published_at: at, created_by: staff?.id ?? null, created_at: at, updated_at: at };
  saveAnnouncement(row);
  notify(memberIdsOfSite(site.id), { kind: 'community', title: row.kind === 'alert' ? `Alert: ${row.title}` : row.title, body: row.body, ref: { type: 'announcement', id: row.id } }, at);
  tellSite(site.id);
  return presentAnnouncement(row);
}

export function editAnnouncement(id: string, body: Record<string, unknown>, nowMs = Date.now()): AnnouncementView {
  const current = findAnnouncement(id);
  if (!current) throw new ApiError('not_found', 'No such notice.');
  const row: AnnouncementRow = { ...current, ...announcementFields({ ...presentAnnouncement(current), ...body }, nowMs), updated_at: new Date(nowMs).toISOString() };
  saveAnnouncement(row);
  tellSite(row.site_id);
  return presentAnnouncement(row);
}

/** Takes a notice down at once (it stays listed for management as expired). */
export function expireAnnouncement(id: string, nowMs = Date.now()): AnnouncementView {
  const current = findAnnouncement(id);
  if (!current) throw new ApiError('not_found', 'No such notice.');
  const at = new Date(nowMs).toISOString();
  const row: AnnouncementRow = { ...current, expires_at: at, updated_at: at };
  saveAnnouncement(row);
  tellSite(row.site_id);
  return presentAnnouncement(row);
}

export function removeAnnouncement(id: string): { removed: boolean } {
  const current = findAnnouncement(id);
  const removed = deleteAnnouncement(id);
  if (current) tellSite(current.site_id);
  return { removed };
}

function eventFields(body: Record<string, unknown>) {
  const startsAt = instant(body.startsAt, 'startsAt');
  const endsAt = instant(body.endsAt, 'endsAt');
  if (endsAt <= startsAt) invalid('endsAt', 'The event must end after it starts.');
  const rsvpOpensAt = optionalInstant(body.rsvpOpensAt, 'rsvpOpensAt');
  const rsvpUntil = optionalInstant(body.rsvpUntil, 'rsvpUntil');
  if (rsvpUntil && rsvpUntil > startsAt) invalid('rsvpUntil', 'Registration must close by the start.');
  if (rsvpOpensAt && rsvpUntil && rsvpUntil <= rsvpOpensAt) invalid('rsvpUntil', 'Registration must close after it opens.');
  let capacity: number | null = null;
  if (body.capacity !== undefined && body.capacity !== null && body.capacity !== '') {
    if (typeof body.capacity !== 'number' || !Number.isInteger(body.capacity) || body.capacity < 1 || body.capacity > 10_000) invalid('capacity', 'Use a whole number from 1 to 10000, or leave it empty.');
    capacity = body.capacity as number;
  }
  return {
    title: text(body.title, 'title', 3, 80, 'Title'),
    description: text(body.description, 'description', 3, 1000, 'Description'),
    starts_at: startsAt,
    ends_at: endsAt,
    venue: text(body.venue, 'venue', 2, 80, 'Venue'),
    picture: pictureOf(body.picture, 'picture'),
    capacity,
    rsvp_opens_at: rsvpOpensAt,
    rsvp_until: rsvpUntil,
  };
}

export function createEvent(siteId: string, body: Record<string, unknown>, nowMs = Date.now()): CommunityEventView {
  const site = requireSiteById(siteId);
  const at = new Date(nowMs).toISOString();
  const fields = eventFields(body);
  if (fields.ends_at <= at) invalid('endsAt', 'The event has already ended.');
  const row: EventRow = { id: randomUUID(), site_id: site.id, ...fields, cancelled_at: null, created_at: at, updated_at: at };
  saveEvent(row);
  notify(memberIdsOfSite(site.id), { kind: 'community', title: `New event: ${row.title}`, body: row.venue, ref: { type: 'event', id: row.id } }, at);
  tellSite(site.id);
  return presentEvents([row], null, at)[0];
}

/** Changes an event; if its time or place changed, those registered are told. */
export function editEvent(id: string, body: Record<string, unknown>, nowMs = Date.now()): CommunityEventView {
  const current = findEvent(id);
  if (!current) throw new ApiError('not_found', 'No such event.');
  if (current.cancelled_at) throw new ApiError('invalid_transition', 'This event was cancelled.');
  const merged = {
    title: current.title, description: current.description, startsAt: current.starts_at, endsAt: current.ends_at, venue: current.venue,
    picture: current.picture, capacity: current.capacity, rsvpOpensAt: current.rsvp_opens_at, rsvpUntil: current.rsvp_until, ...body,
  };
  const at = new Date(nowMs).toISOString();
  const row: EventRow = { ...current, ...eventFields(merged), updated_at: at };
  saveEvent(row);
  if (row.starts_at !== current.starts_at || row.ends_at !== current.ends_at || row.venue !== current.venue) {
    notify(rsvpUserIds(row.id), { kind: 'community', title: `${row.title} has changed`, body: `Now at ${row.venue}.`, ref: { type: 'event', id: row.id } }, at);
  }
  tellSite(row.site_id);
  return presentEvents([row], null, at)[0];
}

export function cancelEvent(id: string, body: Record<string, unknown>, nowMs = Date.now()): CommunityEventView {
  const current = findEvent(id);
  if (!current) throw new ApiError('not_found', 'No such event.');
  if (current.cancelled_at) throw new ApiError('invalid_transition', 'This event was already cancelled.');
  const note = optionalText(body.note, 'note', 300);
  const at = new Date(nowMs).toISOString();
  const row: EventRow = { ...current, cancelled_at: at, updated_at: at };
  saveEvent(row);
  notify(rsvpUserIds(row.id), { kind: 'community', title: `${row.title} is cancelled`, body: note, ref: { type: 'event', id: row.id } }, at);
  tellSite(row.site_id);
  return presentEvents([row], null, at)[0];
}

export function eventAttendees(id: string) {
  if (!findEvent(id)) throw new ApiError('not_found', 'No such event.');
  return rsvpList(id).map((row) => ({ name: row.name, unitName: row.unit_name, at: row.created_at }));
}

export function createPoll(siteId: string, body: Record<string, unknown>, nowMs = Date.now()): PollView {
  const site = requireSiteById(siteId);
  const at = new Date(nowMs).toISOString();
  const question = text(body.question, 'question', 5, 140, 'Question');
  const opensAt = optionalInstant(body.opensAt, 'opensAt') ?? at;
  const closesAt = instant(body.closesAt, 'closesAt');
  if (closesAt <= opensAt || closesAt <= at) invalid('closesAt', 'The poll must close in the future, after it opens.');
  if (Date.parse(closesAt) - Date.parse(opensAt) > MAX_POLL_DAYS * 86_400_000) invalid('closesAt', `A poll can run up to ${MAX_POLL_DAYS} days.`);
  if (!Array.isArray(body.options) || body.options.length < 2 || body.options.length > 6) invalid('options', 'Give 2 to 6 options.');
  const id = randomUUID();
  const options: PollOptionRow[] = (body.options as unknown[]).map((entry, index) => {
    const raw = (typeof entry === 'string' ? { label: entry } : (entry ?? {})) as Record<string, unknown>;
    return { id: randomUUID(), poll_id: id, label: text(raw.label, `options.${index}.label`, 1, 60, 'Option'), picture: pictureOf(raw.picture, `options.${index}.picture`), sort: index };
  });
  const row: PollRow = { id, site_id: site.id, question, opens_at: opensAt, closes_at: closesAt, created_at: at, updated_at: at };
  transaction(() => insertPoll(row, options));
  if (opensAt <= at) notify(memberIdsOfSite(site.id), { kind: 'community', title: 'A new poll is open', body: question, ref: { type: 'poll', id } }, at);
  tellSite(site.id);
  return presentPolls([row], null, at)[0];
}

export function closePoll(id: string, nowMs = Date.now()): PollView {
  const poll = findPoll(id);
  if (!poll) throw new ApiError('not_found', 'No such poll.');
  const at = new Date(nowMs).toISOString();
  if (!closePollAt(id, at)) throw new ApiError('invalid_transition', 'This poll is already closed.');
  tellSite(poll.site_id);
  return presentPolls([findPoll(id) as PollRow], null, at)[0];
}

export function removePoll(id: string): { removed: boolean } {
  const poll = findPoll(id);
  const removed = deletePoll(id);
  if (poll) tellSite(poll.site_id);
  return { removed };
}

export function adminFeedback(siteId: string, statusInput: string | null): AdminFeedbackView[] {
  const site = requireSiteById(siteId);
  const status = statusInput === 'new' || statusInput === 'answered' || statusInput === 'closed' ? statusInput : null;
  return listSiteFeedback(site.id, status).map((row) => ({ ...presentFeedback(row), unitName: row.unit_name, fromName: row.from_name }));
}

/** Answers a message; the resident gets the reply in their inbox. */
export function answerFeedback(staff: User | null, id: string, body: Record<string, unknown>, nowMs = Date.now()): FeedbackView {
  const row = findFeedback(id);
  if (!row) throw new ApiError('not_found', 'No such message.');
  const reply = text(body.reply, 'reply', 1, 1000, 'Reply');
  const at = new Date(nowMs).toISOString();
  if (!replyToFeedback(id, seal(reply), staff?.id ?? null, at)) throw new ApiError('invalid_transition', 'This message is closed.');
  if (row.user_id) notify([row.user_id], { kind: 'community', title: 'Building management replied to your feedback', body: reply, ref: { type: 'feedback', id } }, at);
  return presentFeedback(findFeedback(id) as FeedbackRow);
}

export function closeFeedbackItem(id: string, nowMs = Date.now()): FeedbackView {
  if (!closeFeedback(id, new Date(nowMs).toISOString())) throw new ApiError('not_found', 'No such message.');
  return presentFeedback(findFeedback(id) as FeedbackRow);
}
