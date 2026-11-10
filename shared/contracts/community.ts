/**
 * Community: GET /api/community (announcements, alerts, events, the current poll, past polls),
 * POST /api/community/events/:id/rsvp, /polls/:id/vote, GET | POST /api/community/feedback (residents of the
 * compound); /api/admin/community/… (building management).
 *
 * `picture` is a name from a fixed list of the app's own pictures (e.g. "pool", "yoga", "leaf"), which the app
 * draws; anything it doesn't know falls back to a plain glyph.
 */

export interface AnnouncementView {
  id: string;
  kind: 'news' | 'alert';
  level: 'info' | 'warning';
  title: string;
  body: string;
  /** The rest of the notice, shown when the row is opened. */
  fullText: string | null;
  picture: string | null;
  publishedAt: string;
  expiresAt: string | null;
}

/**
 * `going`: the resident is registered; `open`: registration is open; `soon`: it opens later; `full`: no places
 * left; `closed`: registration has ended.
 */
export type RsvpState = 'going' | 'open' | 'soon' | 'full' | 'closed';

export interface CommunityEventView {
  id: string;
  title: string;
  description: string;
  startsAt: string;
  endsAt: string;
  venue: string;
  picture: string | null;
  capacity: number | null;
  going: number;
  rsvp: RsvpState;
  rsvpOpensAt: string | null;
  rsvpUntil: string | null;
  cancelled: boolean;
}

export interface PollView {
  id: string;
  question: string;
  opensAt: string;
  closesAt: string;
  options: { id: string; label: string; picture: string | null; votes: number }[];
  totalVotes: number;
  /** The option the resident chose, while it is theirs to change. */
  myVote: string | null;
  open: boolean;
}

export interface CommunityFeed {
  announcements: AnnouncementView[];
  alerts: AnnouncementView[];
  events: CommunityEventView[];
  poll: PollView | null;
  pastPolls: PollView[];
  timezone: string;
}

export type FeedbackTopic = 'suggestion' | 'concern' | 'compliment' | 'other';

export interface FeedbackView {
  id: string;
  topic: FeedbackTopic;
  message: string;
  status: 'new' | 'answered' | 'closed';
  reply: string | null;
  repliedAt: string | null;
  createdAt: string;
}

/** Building management's view of a message. */
export interface AdminFeedbackView extends FeedbackView {
  unitName: string | null;
  fromName: string | null;
}
