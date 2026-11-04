import type { IconSet } from '../../components/ui/ServiceTile';
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
  /*
   * Not in the design: "View All" opens each list in place, rows open to
   * their full text, and "Share Feedback" opens a form built on the app's
   * other forms (Visitor Access, Maintenance).
   */
  showLess: 'Show Less',
  pastPollsTitle: 'Past Polls',
  pollClosed: (date: string) => `Closed ${date}`,
  pollVotes: (count: number) => `${count} votes`,
  feedbackFormTitle: 'Share Your Feedback',
  feedbackFormSubtitle: 'Management reads every message.',
  feedbackTopicLabel: 'Topic',
  feedbackTopicPlaceholder: 'Select topic',
  feedbackMessageLabel: 'Message',
  feedbackMessagePlaceholder: 'Tell us what you think',
  feedbackSend: 'Send Feedback',
  feedbackClose: 'Close the feedback form',
  feedbackThanks: 'Thanks for your feedback! Management will review it.',
} as const;

/** Rows each list shows before "View All", as the design draws them. */
export const shownCounts = {
  announcements: 2,
  events: 3,
  alerts: 2,
} as const;

/** A row's picture: a photo, or a glyph on a tinted tile until one exists. */
type RowPicture = { photo: ImageKey; icon?: never } | { photo?: never; icon: { set: IconSet; name: string } };

export type Announcement = RowPicture & {
  id: string;
  title: string;
  body: string;
  /** The rest of the notice, shown when the row is opened. */
  fullText: string;
  /** Display age, e.g. "2h ago". */
  postedAgo: string;
};

export const announcements: readonly Announcement[] = [
  {
    id: 'ann-pool-maintenance',
    title: 'Swimming Pool Maintenance',
    body: 'Pool will be closed on 07 Oct 2026 from 8:00 AM – 4:00 PM for scheduled maintenance.',
    postedAgo: '2h ago',
    photo: 'communityPool',
    fullText:
      'The pool deck, changing rooms and showers are closed for the same hours. The kids’ splash pad stays open.',
  },
  {
    id: 'ann-cafe-open',
    title: 'The Parklane Café is Now Open',
    body: 'Enjoy a new dining experience at the clubhouse.\nOpen daily from 7:00 AM – 10:00 PM.',
    postedAgo: '1d ago',
    photo: 'communityCafe',
    fullText:
      'Breakfast is served until 11:00 AM, and residents get 10% off all week. Find it on the clubhouse ground floor.',
  },
  // Behind "View All".
  {
    id: 'ann-recycling',
    title: 'Recycling Program Launch',
    body: 'Sorting bins are now on every floor of Towers A to D.',
    fullText: 'Blue is for paper, yellow for plastic and metal, green for glass. Collection runs every Tuesday and Saturday.',
    postedAgo: '3d ago',
    icon: { set: 'ionicons', name: 'leaf-outline' },
  },
  {
    id: 'ann-gym',
    title: 'Gym Equipment Upgrade',
    body: 'New cardio machines arrive on 20 Oct 2026.',
    fullText: 'The gym stays open during the installation; the cardio area closes from 9:00 AM to 1:00 PM that day.',
    postedAgo: '5d ago',
    icon: { set: 'ionicons', name: 'barbell-outline' },
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

export type CommunityEvent = RowPicture & {
  id: string;
  title: string;
  /** Shown when the row is opened. */
  description: string;
  /** ISO calendar date, e.g. "2026-10-05". */
  date: string;
  /** Display times bounding the event, e.g. "07:00 PM". */
  from: string;
  to: string;
  venue: string;
  rsvp: RsvpStatus;
};

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
    description: 'A family film on the big screen, with popcorn and juice. Bring a blanket; seating is first come, first served.',
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
    description: 'An all-levels session led by a certified instructor. Mats are provided; arrive ten minutes early.',
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
    description: 'Meet your neighbours over light bites and live music. Registration opens one week before.',
  },
  // Behind "View All".
  {
    id: 'evt-kids-art',
    title: 'Kids Art Workshop',
    date: '2026-10-24',
    from: '10:00 AM',
    to: '12:00 PM',
    venue: 'Clubhouse – Studio',
    icon: { set: 'ionicons', name: 'color-palette-outline' },
    rsvp: 'open',
    description: 'Painting and crafts for ages 5 to 12. All materials are provided; a parent stays on site.',
  },
  {
    id: 'evt-charity-run',
    title: 'Charity Fun Run',
    date: '2026-11-01',
    from: '07:00 AM',
    to: '09:00 AM',
    venue: 'Compound Loop',
    icon: { set: 'ionicons', name: 'walk-outline' },
    rsvp: 'open',
    description: 'A 5 km run or walk around the compound. Every registration supports the children’s hospital.',
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

export type CommunityAlert = RowPicture & {
  id: string;
  level: AlertLevel;
  title: string;
  body: string;
  /** The rest of the alert, shown when the row is opened. */
  fullText: string;
  /** Display age, e.g. "3h ago". */
  postedAgo: string;
};

export const communityAlerts: readonly CommunityAlert[] = [
  {
    id: 'alert-gate',
    level: 'warning',
    title: 'Main Gate System Update',
    body: 'New access system will be active on 06 Oct 2026.',
    postedAgo: '3h ago',
    photo: 'communityGate',
    fullText: 'Residents’ cards keep working. Visitors need a QR pass from Visitor Access from that day on.',
  },
  {
    id: 'alert-pool-hours',
    level: 'info',
    title: 'Pool Schedule Adjustment',
    body: 'Lap swimming hours updated to 6:00 AM – 10:00 AM.',
    postedAgo: '1d ago',
    photo: 'communityPoolNight',
    fullText: 'Two lanes stay reserved for lap swimming during those hours; open swim continues afterwards.',
  },
  // Behind "View All".
  {
    id: 'alert-water',
    level: 'warning',
    title: 'Water Supply Interruption',
    body: 'Tower B, 16 Oct 2026, 10:00 AM – 1:00 PM.',
    fullText: 'Tanks are being cleaned. Please store water in advance; supply returns gradually after 1:00 PM.',
    postedAgo: '2d ago',
    icon: { set: 'ionicons', name: 'water-outline' },
  },
  {
    id: 'alert-garage',
    level: 'info',
    title: 'Parking Garage Cleaning',
    body: 'Level P1 is cleaned on 18 Oct 2026, 7:00 – 11:00 AM.',
    fullText: 'Please move cars from P1 before 7:00 AM; level P2 is open to residents for those hours.',
    postedAgo: '4d ago',
    icon: { set: 'ionicons', name: 'car-outline' },
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

export interface PastPoll {
  id: string;
  question: string;
  /** Display date the poll closed. */
  closedOn: string;
  options: readonly { id: string; label: string; votes: number }[];
}

/** Closed polls and their results, behind the poll's "View All". */
export const pastPolls: readonly PastPoll[] = [
  {
    id: 'poll-2026-q3',
    question: 'Which new amenity should we add first?',
    closedOn: '30 Sep 2026',
    options: [
      { id: 'bbq', label: 'BBQ Area', votes: 212 },
      { id: 'cowork', label: 'Co-working Lounge', votes: 168 },
      { id: 'pets', label: 'Pet Park', votes: 120 },
    ],
  },
  {
    id: 'poll-2026-q2',
    question: 'When suits you best for community events?',
    closedOn: '30 Jun 2026',
    options: [
      { id: 'weekend-evenings', label: 'Weekend evenings', votes: 276 },
      { id: 'weekday-evenings', label: 'Weekday evenings', votes: 134 },
      { id: 'weekend-mornings', label: 'Weekend mornings', votes: 90 },
    ],
  },
];

export const feedbackTopics: readonly string[] = ['Suggestion', 'Concern', 'Compliment', 'Other'];

/** A message needs at least this much to be worth sending. */
const MIN_FEEDBACK_LENGTH = 10;

export interface FeedbackForm {
  topic: string;
  message: string;
}

export type FeedbackErrors = Partial<Record<keyof FeedbackForm, string>>;

/** Frontend checks only; the backend will validate again. */
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
