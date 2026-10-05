import type { StatusTone } from '../../components/ui/StatusChip';
import type { ImageKey } from '../../constants/images';

/**
 * Mock content for the Community screen. Shaped the way a real API response
 * would be, so wiring this to a backend later replaces this module rather
 * than the screen. Wording matches the Figma reference
 * (assets/Screens/screen8.png) exactly.
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
} as const;

export interface Announcement {
  id: string;
  title: string;
  body: string;
  /** Display age, e.g. "2h ago". */
  postedAgo: string;
  photo: ImageKey;
}

export const announcements: readonly Announcement[] = [
  {
    id: 'ann-pool-maintenance',
    title: 'Swimming Pool Maintenance',
    body: 'Pool will be closed on 07 Oct 2026 from 8:00 AM – 4:00 PM for scheduled maintenance.',
    postedAgo: '2h ago',
    photo: 'communityPool',
  },
  {
    id: 'ann-cafe-open',
    title: 'The Parklane Café is Now Open',
    body: 'Enjoy a new dining experience at the clubhouse.\nOpen daily from 7:00 AM – 10:00 PM.',
    postedAgo: '1d ago',
    photo: 'communityCafe',
  },
];

/**
 * `open` takes registrations, `going` is the resident's RSVP, and `soon` has
 * not opened yet. Only `open` and `going` can be toggled.
 */
export type RsvpStatus = 'open' | 'going' | 'soon';

export const rsvpDisplay: Record<RsvpStatus, { label: string; tone: StatusTone }> = {
  open: { label: 'Register', tone: 'indigo' },
  going: { label: 'I’m Going', tone: 'teal' },
  soon: { label: 'Coming Soon', tone: 'slate' },
};

export interface CommunityEvent {
  id: string;
  title: string;
  /** ISO calendar date, e.g. "2026-10-05". */
  date: string;
  /** Display times bounding the event, e.g. "07:00 PM". */
  from: string;
  to: string;
  venue: string;
  photo: ImageKey;
  rsvp: RsvpStatus;
}

export const upcomingEvents: readonly CommunityEvent[] = [
  {
    id: 'evt-movie-night',
    title: 'Family Movie Night',
    date: '2026-10-05',
    from: '07:00 PM',
    to: '10:00 PM',
    venue: 'Clubhouse – Grand Lounge',
    photo: 'communityMovie',
    rsvp: 'going',
  },
  {
    id: 'evt-yoga',
    title: 'Morning Yoga Session',
    date: '2026-10-12',
    from: '08:00 AM',
    to: '09:00 AM',
    venue: 'Central Garden',
    photo: 'communityYoga',
    rsvp: 'open',
  },
  {
    id: 'evt-gathering',
    title: 'Community Gathering',
    date: '2026-10-18',
    from: '06:00 PM',
    to: '09:00 PM',
    venue: 'Rooftop Terrace',
    photo: 'communityGathering',
    rsvp: 'soon',
  },
];

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/**
 * "2026-10-05" as the date column draws it: "05" over "OCT". Read from the
 * string itself, so the device's time zone can never shift the day.
 */
export function dateParts(isoDate: string): { day: string; month: string } {
  const [, month, day] = isoDate.split('-');
  return { day, month: MONTHS[Number(month) - 1] ?? '' };
}

/** "07:00 PM – 10:00 PM". */
export function timeRange({ from, to }: Pick<CommunityEvent, 'from' | 'to'>): string {
  return `${from} – ${to}`;
}

/** `warning` is drawn on the emergency red, `info` on the panel's navy. */
export type AlertLevel = 'warning' | 'info';

export interface CommunityAlert {
  id: string;
  level: AlertLevel;
  title: string;
  body: string;
  /** Display age, e.g. "3h ago". */
  postedAgo: string;
  photo: ImageKey;
}

export const communityAlerts: readonly CommunityAlert[] = [
  {
    id: 'alert-gate',
    level: 'warning',
    title: 'Main Gate System Update',
    body: 'New access system will be active on 06 Oct 2026.',
    postedAgo: '3h ago',
    photo: 'communityGate',
  },
  {
    id: 'alert-pool-hours',
    level: 'info',
    title: 'Pool Schedule Adjustment',
    body: 'Lap swimming hours updated to 6:00 AM – 10:00 AM.',
    postedAgo: '1d ago',
    photo: 'communityPoolNight',
  },
];

export interface PollOption {
  id: string;
  label: string;
  photo: ImageKey;
  /** Votes so far, including the resident's own if `poll.myVote` names this option. */
  votes: number;
}

export interface Poll {
  id: string;
  options: readonly PollOption[];
  /** The option the resident voted for when the screen loaded, if any. */
  myVote?: string;
}

/** 340 / 110 / 50 of 500 votes: the design's 68%, 22% and 10%. */
export const currentPoll: Poll = {
  id: 'poll-2026-q4',
  myVote: 'more-events',
  options: [
    { id: 'more-events', label: 'More Community Events', photo: 'communityPollEvents', votes: 340 },
    { id: 'fitness', label: 'Additional Fitness Classes', photo: 'communityPollFitness', votes: 110 },
    { id: 'kids', label: 'Kids & Family Activities', photo: 'communityPollKids', votes: 50 },
  ],
};

/**
 * Each option's share of the vote, 0-1, with the resident's vote moved from
 * the one they loaded with to `vote`.
 */
export function pollShares(poll: Poll, vote: string | undefined): Record<string, number> {
  const counts = poll.options.map((option) => {
    let votes = option.votes;
    if (option.id === poll.myVote) votes -= 1;
    if (option.id === vote) votes += 1;
    return { id: option.id, votes: Math.max(0, votes) };
  });
  const total = counts.reduce((sum, { votes }) => sum + votes, 0);
  return Object.fromEntries(counts.map(({ id, votes }) => [id, total > 0 ? votes / total : 0]));
}
