import type { BmsLatest, EnergyLatest, SeriesAnswer } from '../../../../../shared/contracts/series';
import { call } from '../../ems/services/emsHttp';

/** Quarter-hour readings on the EMS backend (backend/src/routes/series.ts); null while there are none. */

export const getBmsLatest = () => call<BmsLatest | null>('/api/sites/me/bms/latest', { retry: true });

export const getEnergyLatest = () => call<EnergyLatest | null>('/api/units/me/energy/latest', { retry: true });

export const getBmsSeries = (metrics: string[], from: string, to: string, bucket: '15m' | '1h' | '1d') =>
  call<SeriesAnswer>(`/api/sites/me/bms/series?metrics=${metrics.join(',')}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&bucket=${bucket}`, { retry: true });

export const getEnergySeries = (metrics: string[], from: string, to: string, bucket: '15m' | '1h' | '1d') =>
  call<SeriesAnswer>(`/api/units/me/energy/series?metrics=${metrics.join(',')}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&bucket=${bucket}`, { retry: true });
