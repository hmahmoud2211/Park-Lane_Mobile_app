import { db } from '../ems/db.ts';

/**
 * The announcements, community_events, event_rsvps, polls, poll_options, poll_votes and feedback tables
 * (migration 17). community/community.ts seals and unseals feedback.
 */

export interface AnnouncementRow {
  id: string;
  site_id: string;
  kind: 'news' | 'alert';
  level: 'info' | 'warning';
  title: string;
  body: string;
  full_text: string | null;
  picture: string | null;
  published_at: string;
  expires_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventRow {
  id: string;
  site_id: string;
  title: string;
  description: string;
  starts_at: string;
  ends_at: string;
  venue: string;
  picture: string | null;
  capacity: number | null;
  rsvp_opens_at: string | null;
  rsvp_until: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface PollRow {
  id: string;
  site_id: string;
  question: string;
  opens_at: string;
  closes_at: string;
  created_at: string;
  updated_at: string;
}

export interface PollOptionRow {
  id: string;
  poll_id: string;
  label: string;
  picture: string | null;
  sort: number;
}

export interface FeedbackRow {
  id: string;
  site_id: string;
  unit_id: string | null;
  user_id: string | null;
  topic: 'suggestion' | 'concern' | 'compliment' | 'other';
  message: string;
  status: 'new' | 'answered' | 'closed';
  reply: string | null;
  replied_by: string | null;
  replied_at: string | null;
  created_at: string;
  updated_at: string;
}

const placeholders = (values: readonly unknown[]) => values.map(() => '?').join(', ');

// ---- announcements ------------------------------------------------------------------------------------

/** What residents see now: published, not expired, newest first. */
export function listLiveAnnouncements(siteId: string, now: string): AnnouncementRow[] {
  return db()
    .prepare('SELECT * FROM announcements WHERE site_id = ? AND published_at <= ? AND (expires_at IS NULL OR expires_at > ?) ORDER BY published_at DESC LIMIT 50')
    .all(siteId, now, now) as unknown as AnnouncementRow[];
}

export function listAllAnnouncements(siteId: string): AnnouncementRow[] {
  return db().prepare('SELECT * FROM announcements WHERE site_id = ? ORDER BY published_at DESC LIMIT 200').all(siteId) as unknown as AnnouncementRow[];
}

export function findAnnouncement(id: string): AnnouncementRow | undefined {
  return db().prepare('SELECT * FROM announcements WHERE id = ?').get(id) as AnnouncementRow | undefined;
}

export function saveAnnouncement(row: AnnouncementRow): void {
  db()
    .prepare(
      `INSERT INTO announcements (id, site_id, kind, level, title, body, full_text, picture, published_at, expires_at, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, level = excluded.level, title = excluded.title, body = excluded.body,
         full_text = excluded.full_text, picture = excluded.picture, expires_at = excluded.expires_at, updated_at = excluded.updated_at`,
    )
    .run(row.id, row.site_id, row.kind, row.level, row.title, row.body, row.full_text, row.picture, row.published_at, row.expires_at, row.created_by, row.created_at, row.updated_at);
}

export function deleteAnnouncement(id: string): boolean {
  return Number(db().prepare('DELETE FROM announcements WHERE id = ?').run(id).changes) > 0;
}

// ---- events -------------------------------------------------------------------------------------------

export function listUpcomingEvents(siteId: string, now: string, includeCancelled = false): EventRow[] {
  return db()
    .prepare(`SELECT * FROM community_events WHERE site_id = ? AND ends_at >= ? ${includeCancelled ? '' : 'AND cancelled_at IS NULL'} ORDER BY starts_at LIMIT 100`)
    .all(siteId, now) as unknown as EventRow[];
}

export function listRecentEvents(siteId: string, since: string): EventRow[] {
  return db().prepare('SELECT * FROM community_events WHERE site_id = ? AND ends_at >= ? ORDER BY starts_at LIMIT 200').all(siteId, since) as unknown as EventRow[];
}

export function findEvent(id: string): EventRow | undefined {
  return db().prepare('SELECT * FROM community_events WHERE id = ?').get(id) as EventRow | undefined;
}

export function saveEvent(row: EventRow): void {
  db()
    .prepare(
      `INSERT INTO community_events (id, site_id, title, description, starts_at, ends_at, venue, picture, capacity, rsvp_opens_at, rsvp_until, cancelled_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET title = excluded.title, description = excluded.description, starts_at = excluded.starts_at,
         ends_at = excluded.ends_at, venue = excluded.venue, picture = excluded.picture, capacity = excluded.capacity,
         rsvp_opens_at = excluded.rsvp_opens_at, rsvp_until = excluded.rsvp_until, cancelled_at = excluded.cancelled_at, updated_at = excluded.updated_at`,
    )
    .run(
      row.id, row.site_id, row.title, row.description, row.starts_at, row.ends_at, row.venue, row.picture, row.capacity, row.rsvp_opens_at,
      row.rsvp_until, row.cancelled_at, row.created_at, row.updated_at,
    );
}

export function rsvpCounts(eventIds: readonly string[]): Map<string, number> {
  if (eventIds.length === 0) return new Map();
  const rows = db()
    .prepare(`SELECT event_id, COUNT(*) AS n FROM event_rsvps WHERE event_id IN (${placeholders(eventIds)}) GROUP BY event_id`)
    .all(...eventIds) as { event_id: string; n: number }[];
  return new Map(rows.map((row) => [row.event_id, row.n]));
}

export function myRsvps(userId: string, eventIds: readonly string[]): Set<string> {
  if (eventIds.length === 0) return new Set();
  const rows = db()
    .prepare(`SELECT event_id FROM event_rsvps WHERE user_id = ? AND event_id IN (${placeholders(eventIds)})`)
    .all(userId, ...eventIds) as { event_id: string }[];
  return new Set(rows.map((row) => row.event_id));
}

export function insertRsvp(eventId: string, userId: string, at: string): boolean {
  return Number(db().prepare('INSERT OR IGNORE INTO event_rsvps (event_id, user_id, created_at) VALUES (?, ?, ?)').run(eventId, userId, at).changes) > 0;
}

export function deleteRsvp(eventId: string, userId: string): boolean {
  return Number(db().prepare('DELETE FROM event_rsvps WHERE event_id = ? AND user_id = ?').run(eventId, userId).changes) > 0;
}

export function rsvpUserIds(eventId: string): string[] {
  return (db().prepare('SELECT user_id FROM event_rsvps WHERE event_id = ?').all(eventId) as { user_id: string }[]).map((row) => row.user_id);
}

/** Who is coming, for management: names and apartments. */
export function rsvpList(eventId: string): { name: string; unit_name: string | null; created_at: string }[] {
  return db()
    .prepare(
      `SELECT users.name AS name, units.name AS unit_name, event_rsvps.created_at AS created_at FROM event_rsvps
       JOIN users ON users.id = event_rsvps.user_id
       LEFT JOIN unit_members ON unit_members.user_id = users.id LEFT JOIN units ON units.id = unit_members.unit_id
       WHERE event_rsvps.event_id = ? ORDER BY event_rsvps.created_at`,
    )
    .all(eventId) as { name: string; unit_name: string | null; created_at: string }[];
}

// ---- polls --------------------------------------------------------------------------------------------

export function listPolls(siteId: string, limit = 20): PollRow[] {
  return db().prepare('SELECT * FROM polls WHERE site_id = ? ORDER BY closes_at DESC LIMIT ?').all(siteId, limit) as unknown as PollRow[];
}

export function findPoll(id: string): PollRow | undefined {
  return db().prepare('SELECT * FROM polls WHERE id = ?').get(id) as PollRow | undefined;
}

export function insertPoll(row: PollRow, options: readonly PollOptionRow[]): void {
  db().prepare('INSERT INTO polls (id, site_id, question, opens_at, closes_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    row.id, row.site_id, row.question, row.opens_at, row.closes_at, row.created_at, row.updated_at,
  );
  const insert = db().prepare('INSERT INTO poll_options (id, poll_id, label, picture, sort) VALUES (?, ?, ?, ?, ?)');
  for (const option of options) insert.run(option.id, option.poll_id, option.label, option.picture, option.sort);
}

export function closePollAt(id: string, at: string): boolean {
  return Number(db().prepare('UPDATE polls SET closes_at = ?, updated_at = ? WHERE id = ? AND closes_at > ?').run(at, at, id, at).changes) > 0;
}

export function deletePoll(id: string): boolean {
  return Number(db().prepare('DELETE FROM polls WHERE id = ?').run(id).changes) > 0;
}

export function listPollOptions(pollIds: readonly string[]): PollOptionRow[] {
  if (pollIds.length === 0) return [];
  return db().prepare(`SELECT * FROM poll_options WHERE poll_id IN (${placeholders(pollIds)}) ORDER BY sort`).all(...pollIds) as unknown as PollOptionRow[];
}

export function voteCounts(pollIds: readonly string[]): Map<string, number> {
  if (pollIds.length === 0) return new Map();
  const rows = db()
    .prepare(`SELECT option_id, COUNT(*) AS n FROM poll_votes WHERE poll_id IN (${placeholders(pollIds)}) GROUP BY option_id`)
    .all(...pollIds) as { option_id: string; n: number }[];
  return new Map(rows.map((row) => [row.option_id, row.n]));
}

export function myVotes(userId: string, pollIds: readonly string[]): Map<string, string> {
  if (pollIds.length === 0) return new Map();
  const rows = db()
    .prepare(`SELECT poll_id, option_id FROM poll_votes WHERE user_id = ? AND poll_id IN (${placeholders(pollIds)})`)
    .all(userId, ...pollIds) as { poll_id: string; option_id: string }[];
  return new Map(rows.map((row) => [row.poll_id, row.option_id]));
}

/** One vote per resident: a second vote replaces the first. */
export function upsertVote(pollId: string, userId: string, optionId: string, at: string): void {
  db()
    .prepare(
      `INSERT INTO poll_votes (poll_id, user_id, option_id, voted_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(poll_id, user_id) DO UPDATE SET option_id = excluded.option_id, voted_at = excluded.voted_at`,
    )
    .run(pollId, userId, optionId, at);
}

// ---- feedback -----------------------------------------------------------------------------------------

export function insertFeedback(row: FeedbackRow): void {
  db()
    .prepare(
      `INSERT INTO feedback (id, site_id, unit_id, user_id, topic, message, status, reply, replied_by, replied_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`,
    )
    .run(row.id, row.site_id, row.unit_id, row.user_id, row.topic, row.message, row.status, row.created_at, row.updated_at);
}

export function findFeedback(id: string): FeedbackRow | undefined {
  return db().prepare('SELECT * FROM feedback WHERE id = ?').get(id) as FeedbackRow | undefined;
}

export function listUserFeedback(userId: string): FeedbackRow[] {
  return db().prepare('SELECT * FROM feedback WHERE user_id = ? ORDER BY created_at DESC LIMIT 50').all(userId) as unknown as FeedbackRow[];
}

export function listSiteFeedback(siteId: string, status: FeedbackRow['status'] | null): (FeedbackRow & { unit_name: string | null; from_name: string | null })[] {
  return db()
    .prepare(
      `SELECT feedback.*, units.name AS unit_name, users.name AS from_name FROM feedback
       LEFT JOIN units ON units.id = feedback.unit_id LEFT JOIN users ON users.id = feedback.user_id
       WHERE feedback.site_id = ? ${status ? 'AND feedback.status = ?' : ''} ORDER BY feedback.status = 'new' DESC, feedback.created_at DESC LIMIT 300`,
    )
    .all(...(status ? [siteId, status] : [siteId])) as unknown as (FeedbackRow & { unit_name: string | null; from_name: string | null })[];
}

export function replyToFeedback(id: string, reply: string, by: string | null, at: string): boolean {
  return Number(
    db().prepare("UPDATE feedback SET reply = ?, replied_by = ?, replied_at = ?, status = 'answered', updated_at = ? WHERE id = ? AND status != 'closed'").run(reply, by, at, at, id).changes,
  ) > 0;
}

export function closeFeedback(id: string, at: string): boolean {
  return Number(db().prepare("UPDATE feedback SET status = 'closed', updated_at = ? WHERE id = ?").run(at, id).changes) > 0;
}
