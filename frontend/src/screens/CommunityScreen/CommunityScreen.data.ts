import type { IconSet } from '../../types/icons.types';
import type { StatusTone } from '../../components/ui/StatusChip';
import type { ImageKey } from '../../constants/images';
import { pictureFor } from '../../constants/pictures';
import type { AnnouncementView, CommunityEventView, FeedbackTopic, PollView, RsvpState } from '../../../../shared/contracts/community';
import { formatClock12, formatDate, SHORT_MONTHS } from '../../utils/format';
import { zonedDate, zonedTime } from '../../utils/zonedTime';

/**
 * The Community screen's copy, and how it reads what building management published (GET /api/community).
 * Wording matches the Figma reference (assets/Screens/screen8.png).
 */

export const communityCopy = {
  title: 'Community',
  bannerTitle: 'Parklane Community',
  bannerBody: 'More than a residence.\nA connected community\nfor a better tomorrow.',
  announcementsTitle: 'Announcements',
  eventsTitle: 'Upcoming Events',
  alertsTitle: 'Community Alerts',
  pollTitle: 'Help Shape Parklane',
  pollSubtitle: 'Your opinion helps us create a better community.',
  feedbackTitle: 'Resident Feedback',
  /** One run of text: the card is narrower in Inter than the design's two lines. */
  feedbackBody: 'Share your ideas, suggestions or concerns. Together we make Parklane even better.',
  feedbackCta: 'Share Feedback',
  viewAll: 'View All',
  /*
   * Not in the design: "View All" opens each list in place, rows open to their full text, "Share Feedback" opens
   * a form, and the empty, loading and error states.
   */
  showLess: 'Show Less',
  pastPollsTitle: 'Past Polls',
  pollClosed: (date: string) => `Closed ${date}`,
  pollVotes: (count: number) => (count === 1 ? '1 vote' : `${count} votes`),
  pollCloses: (date: string) => `Open until ${date}`,
  feedbackFormTitle: 'Share Your Feedback',
  feedbackFormSubtitle: 'Management reads every message.',
  feedbackTopicLabel: 'Topic',
  feedbackTopicPlaceholder: 'Select topic',
  feedbackMessageLabel: 'Message',
  feedbackMessagePlaceholder: 'Tell us what you think',
  feedbackSend: 'Send Feedback',
  feedbackSending: 'Sending…',
  feedbackClose: 'Close the feedback form',
  feedbackThanks: 'Thanks for your feedback! Management will review it and reply in your inbox.',
  noAnnouncements: 'No announcements right now.',
  noEvents: 'No upcoming events.',
  noAlerts: 'No alerts. All is well.',
  noPoll: 'No poll is open right now.',
  loadFailed: 'Couldn’t load the community',
  retry: 'Try again',
  noHomeTitle: 'Not linked to an apartment yet',
  noHomeBody: 'Ask building management to add your account to your apartment. Community news then appears here.',
} as const;

/** Rows each list shows before "View All", as the design draws them. */
export const shownCounts = {
  announcements: 2,
  events: 3,
  alerts: 2,
} as const;

/** A row's picture: a photo, or a glyph on a tinted tile. */
type RowPicture = { photo: ImageKey; icon?: never } | { photo?: never; icon: { set: IconSet; name: string } };

export type Announcement = RowPicture & {
  id: string;
  title: string;
  body: string;
  /** Shown when the row is opened. */
  fullText: string;
  /** "2h ago". */
  postedAgo: string;
};

/** "just now", "5m ago", "2h ago", "3d ago", then the date. */
export function agoLabel(iso: string, nowMs: number): string {
  const minutes = Math.max(0, Math.floor((nowMs - Date.parse(iso)) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h ago`;
  if (minutes < 14 * 24 * 60) return `${Math.floor(minutes / 1440)}d ago`;
  return formatDate(new Date(iso));
}

export function toAnnouncement(item: AnnouncementView, nowMs: number): Announcement {
  const fallback = item.kind === 'alert' ? { set: 'ionicons' as const, name: item.level === 'warning' ? 'warning-outline' : 'information-circle-outline' } : { set: 'ionicons' as const, name: 'megaphone-outline' };
  return {
    id: item.id,
    title: item.title,
    body: item.body,
    fullText: item.fullText ?? item.body,
    postedAgo: agoLabel(item.publishedAt, nowMs),
    ...pictureFor(item.picture, fallback),
  };
}

/** `warning` is drawn on the emergency red, `info` on the panel's navy. */
export type AlertLevel = 'warning' | 'info';

export const rsvpDisplay: Record<RsvpState, { label: string; tone: StatusTone }> = {
  open: { label: 'Register', tone: 'indigo' },
  going: { label: 'I’m Going', tone: 'teal' },
  soon: { label: 'Coming Soon', tone: 'slate' },
  full: { label: 'Full', tone: 'amber' },
  closed: { label: 'Closed', tone: 'slate' },
};

export type CommunityEvent = RowPicture & {
  id: string;
  title: string;
  description: string;
  /** The compound's calendar date, YYYY-MM-DD. */
  date: string;
  /** "07:00 PM". */
  from: string;
  to: string;
  venue: string;
  rsvp: RsvpState;
};

const clock = (iso: string, timeZone: string) => {
  const [hours, minutes] = zonedTime(Date.parse(iso), timeZone).split(':').map(Number);
  return formatClock12(hours, minutes);
};

export function toEvent(item: CommunityEventView, timeZone: string): CommunityEvent {
  return {
    id: item.id,
    title: item.title,
    description: item.capacity ? `${item.description}\n${item.going} of ${item.capacity} places taken.` : item.description,
    date: zonedDate(Date.parse(item.startsAt), timeZone),
    from: clock(item.startsAt, timeZone),
    to: clock(item.endsAt, timeZone),
    venue: item.venue,
    rsvp: item.rsvp,
    ...pictureFor(item.picture, { set: 'ionicons', name: 'calendar-outline' }),
  };
}

/** Only these can be tapped: registering, or withdrawing. */
export const canToggleRsvp = (state: RsvpState) => state === 'open' || state === 'going';

/**
 * "2026-10-05" as the date column draws it: "05" over "OCT". Read from the string itself, so the device's time
 * zone can never shift the day.
 */
export function dateParts(isoDate: string): { day: string; month: string } {
  const [, month, day] = isoDate.split('-');
  return { day, month: SHORT_MONTHS[Number(month) - 1]?.toUpperCase() ?? '' };
}

/** "07:00 PM – 10:00 PM". */
export function timeRange({ from, to }: Pick<CommunityEvent, 'from' | 'to'>): string {
  return `${from} – ${to}`;
}

export type CommunityAlert = Announcement & { level: AlertLevel };

export const toAlert = (item: AnnouncementView, nowMs: number): CommunityAlert => ({ ...toAnnouncement(item, nowMs), level: item.level });

/** Each option's share of the vote, 0-1. */
export function pollShares(poll: PollView): Record<string, number> {
  return Object.fromEntries(poll.options.map((option) => [option.id, poll.totalVotes > 0 ? option.votes / poll.totalVotes : 0]));
}

/** "30 Sep 2026", on the compound's calendar. */
export function closedOn(iso: string, timeZone: string): string {
  const [year, month, day] = zonedDate(Date.parse(iso), timeZone).split('-').map(Number);
  return formatDate(new Date(year, month - 1, day));
}

export const feedbackTopics: readonly string[] = ['Suggestion', 'Concern', 'Compliment', 'Other'];

const TOPIC_VALUE: Record<string, FeedbackTopic> = { Suggestion: 'suggestion', Concern: 'concern', Compliment: 'compliment', Other: 'other' };

export const topicValue = (label: string): FeedbackTopic => TOPIC_VALUE[label] ?? 'other';

/** A message needs at least this much to be worth sending (the backend checks it too). */
const MIN_FEEDBACK_LENGTH = 10;

export interface FeedbackForm {
  topic: string;
  message: string;
}

export type FeedbackErrors = Partial<Record<keyof FeedbackForm, string>>;

export function validateFeedback(form: FeedbackForm): FeedbackErrors {
  const errors: FeedbackErrors = {};
  if (!form.topic) {
    errors.topic = 'Choose a topic';
  }
  if (form.message.trim().length < MIN_FEEDBACK_LENGTH) {
    errors.message = 'Write a little more so we can act on it';
  }
  return errors;
}
