import type { Charge, Payment, UnitOverview } from '../../../../../shared/contracts/unitFinance';
import { call } from '../../ems/services/emsHttp';

/** My Unit and Bills on the EMS backend (backend/src/routes/unitFinance.ts). */

export const getUnitOverview = () => call<UnitOverview>('/api/unit/overview', { retry: true });

/** `bills`: service and utility charges; `installments`: the contract's. Owners only. */
export const getUnitCharges = (group: 'bills' | 'installments' | 'all' = 'all') =>
  call<Charge[]>(`/api/unit/charges?group=${group}`, { retry: true });

export const getUnitPayments = () => call<Payment[]>('/api/unit/payments', { retry: true });
