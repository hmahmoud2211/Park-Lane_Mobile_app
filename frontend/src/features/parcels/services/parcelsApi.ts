import type { Parcel } from '../../../../../shared/contracts/parcels';
import { call } from '../../ems/services/emsHttp';

/** Parcels the gate logged for the resident's unit (backend/src/routes/visitors.ts). */
export const listParcels = () => call<Parcel[]>('/api/parcels', { retry: true });
