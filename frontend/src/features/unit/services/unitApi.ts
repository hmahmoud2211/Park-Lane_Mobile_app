import { call } from '../../ems/services/emsHttp';
import type { MyUnit, UnitInvite, UnitRole } from '../types';

/**
 * The resident's apartment, through the EMS backend (backend/src/routes/unit.ts). Being a
 * member is what opens both the unit's brand-account devices and its CUBE gateway through
 * the account (features/gateway/services/accountLogin.ts).
 */

/** 404 `no_home` when the resident has no apartment. */
export const getUnit = () => call<MyUnit>('/api/unit', { retry: true });

/** Owners only. Single use, valid 24 hours. */
export const createInvite = (role: UnitRole) => call<UnitInvite>('/api/unit/invites', { method: 'POST', body: { role } });

/** 422 `invalid` (wrong, used or expired), 409 `conflict` (already in another apartment). */
export const joinUnit = (code: string) => call<MyUnit>('/api/unit/join', { method: 'POST', body: { code } });

/** Owners only; answers with the unit as it is now. */
export const removeMember = (userId: string) => call<MyUnit>(`/api/unit/members/${encodeURIComponent(userId)}`, { method: 'DELETE' });
