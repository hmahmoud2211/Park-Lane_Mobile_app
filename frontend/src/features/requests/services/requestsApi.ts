import type { NewServiceRequest, ServiceKind, ServiceRequest, ServiceRequestOptions } from '../../../../../shared/contracts/serviceRequests';
import { call } from '../../ems/services/emsHttp';

/** Maintenance, housekeeping and moving requests on the EMS backend (backend/src/routes/requests.ts). */

export const getRequestOptions = (kind: ServiceKind) =>
  call<ServiceRequestOptions>(`/api/requests/options?kind=${encodeURIComponent(kind)}`, { retry: true });

export const listServiceRequests = () => call<ServiceRequest[]>('/api/requests', { retry: true });

export const createServiceRequest = (request: NewServiceRequest) => call<ServiceRequest>('/api/requests', { method: 'POST', body: request });

export const cancelServiceRequest = (id: string) => call<ServiceRequest>(`/api/requests/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
