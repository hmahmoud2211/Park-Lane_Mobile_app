import type { CommunityEventView, CommunityFeed, FeedbackTopic, FeedbackView, PollView } from '../../../../../shared/contracts/community';
import { call } from '../../ems/services/emsHttp';

/** Community on the EMS backend (backend/src/routes/community.ts). */

export const getCommunity = () => call<CommunityFeed>('/api/community', { retry: true });

export const setRsvp = (eventId: string, going: boolean) =>
  call<CommunityEventView>(`/api/community/events/${encodeURIComponent(eventId)}/rsvp`, { method: 'POST', body: { going } });

export const castVote = (pollId: string, optionId: string) =>
  call<PollView>(`/api/community/polls/${encodeURIComponent(pollId)}/vote`, { method: 'POST', body: { optionId } });

export const sendFeedback = (topic: FeedbackTopic, message: string) =>
  call<FeedbackView>('/api/community/feedback', { method: 'POST', body: { topic, message } });
