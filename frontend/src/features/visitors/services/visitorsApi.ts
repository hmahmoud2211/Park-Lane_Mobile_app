import type { NewVisitorPass, VisitorPass } from '../../../../../shared/contracts/visitors';
import { call } from '../../ems/services/emsHttp';

/** Visitor passes on the EMS backend (backend/src/routes/visitors.ts); the gate checks them online. */

export const listVisitorPasses = () => call<VisitorPass[]>('/api/visitors', { retry: true });

export const createVisitorPass = (pass: NewVisitorPass) => call<VisitorPass>('/api/visitors', { method: 'POST', body: pass });

export const revokeVisitorPass = (id: string) => call<VisitorPass>(`/api/visitors/${encodeURIComponent(id)}/revoke`, { method: 'POST' });
