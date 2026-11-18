import { call } from '../../ems/services/emsHttp';
import type {
  Circle,
  CircleInvite,
  CircleInvitePreview,
  LiveWatch,
  LocationReport,
  LocationReportResult,
  LocationToken,
  OpenCircleInvite,
} from '../types';

/**
 * Family Circle through the EMS backend (backend/src/routes/circles.ts). Circles are groups of accounts that share
 * their location and battery; each member turns their own sharing on or off.
 */

const circlePath = (id: string) => `/api/circles/${encodeURIComponent(id)}`;

/** My Circles with their members and the positions I may see. */
export const listCircles = () => call<Circle[]>('/api/circles', { retry: true });

export const createCircle = (name: string) => call<Circle>('/api/circles', { method: 'POST', body: { name } });

/** Owners only. */
export const renameCircle = (id: string, name: string) => call<Circle>(circlePath(id), { method: 'PATCH', body: { name } });

/** Owners only. */
export const deleteCircle = (id: string) => call<{ deleted: true }>(circlePath(id), { method: 'DELETE' });

/** My own sharing in this Circle. */
export const setSharing = (id: string, sharing: boolean) => call<Circle>(`${circlePath(id)}/sharing`, { method: 'PUT', body: { sharing } });

/** Owners only: a code that works once, for 24 hours. */
export const createInvite = (id: string) => call<CircleInvite>(`${circlePath(id)}/invites`, { method: 'POST' });

/** Owners only: invites nobody has used yet. */
export const listInvites = (id: string) => call<OpenCircleInvite[]>(`${circlePath(id)}/invites`, { retry: true });

/** Owners only; answers with the invites still open. */
export const cancelInvite = (id: string, inviteId: string) =>
  call<OpenCircleInvite[]>(`${circlePath(id)}/invites/${encodeURIComponent(inviteId)}`, { method: 'DELETE' });

/** Which Circle a code is for, without joining. Refused like joinCircle. */
export const checkInvite = (code: string) => call<CircleInvitePreview>('/api/circles/invites/check', { method: 'POST', body: { code } });

/** 422 `invalid`, 410 `invite_expired` / `invite_used`, 409 `conflict` (the Circle is full, or I am in 10). */
export const joinCircle = (code: string) => call<Circle>('/api/circles/join', { method: 'POST', body: { code } });

/** Owners remove anyone; anyone removes themselves (leaving). Answers with my Circles as they are now. */
export const removeMember = (id: string, userId: string) => call<Circle[]>(`${circlePath(id)}/members/${encodeURIComponent(userId)}`, { method: 'DELETE' });

/** The Circle's map is open: its sharing members send fast updates for the next minute. Repeat every ~30 s. */
export const watchCircle = (circleId: string) => call<LiveWatch>('/api/location/watch', { method: 'POST', body: { circleId } });

/** A token that can only send location reports, for the background task. */
export const createLocationToken = () => call<LocationToken>('/api/location/token', { method: 'POST' });

/** Sends the phone's points and battery, with the session or (`bearer`) the background task's location token. */
export const sendLocationReport = (report: LocationReport, bearer?: string) =>
  call<LocationReportResult>('/api/location/report', { method: 'POST', body: report, bearer });
