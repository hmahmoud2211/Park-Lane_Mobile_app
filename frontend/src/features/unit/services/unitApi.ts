import { call } from '../../ems/services/emsHttp';
import type { MyUnit, OpenUnitInvite, UnitInvite, UnitInvitePreview, UnitRole } from '../types';

/**
 * The resident's apartment, through the EMS backend (backend/src/routes/unit.ts). Being a
 * member is what opens both the unit's brand-account devices and its CUBE gateway through
 * the account (features/gateway/services/accountLogin.ts).
 */

/** 404 `no_home` when the resident has no apartment. */
export const getUnit = () => call<MyUnit>('/api/unit', { retry: true });

/** Owners only. Single use, valid 24 hours. */
export const createInvite = (role: UnitRole) => call<UnitInvite>('/api/unit/invites', { method: 'POST', body: { role } });

/** Which apartment a code is for, without joining. Refused like joinUnit. */
export const checkInvite = (code: string) => call<UnitInvitePreview>('/api/unit/invites/check', { method: 'POST', body: { code } });

/**
 * 422 `invalid` (no such code), 410 `invite_expired` / `invite_used`, 409 `conflict` (already in
 * another apartment). A code for the apartment you are already in just answers with it.
 */
export const joinUnit = (code: string) => call<MyUnit>('/api/unit/join', { method: 'POST', body: { code } });

/** Owners only: invites nobody has used yet, newest first. */
export const listInvites = () => call<OpenUnitInvite[]>('/api/unit/invites', { retry: true });

/** Owners only: the code stops working at once. Answers with the invites still open. */
export const cancelInvite = (id: string) => call<OpenUnitInvite[]>(`/api/unit/invites/${encodeURIComponent(id)}`, { method: 'DELETE' });

/** Owners only; answers with the unit as it is now. */
export const removeMember = (userId: string) => call<MyUnit>(`/api/unit/members/${encodeURIComponent(userId)}`, { method: 'DELETE' });
