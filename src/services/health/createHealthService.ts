import { getSessionToken } from '../ems/emsApi';
import type { HealthLang } from './health.types';
import type { HealthService } from './healthService';
import { HttpHealthService } from './httpHealthService';

export interface HealthServiceDeps {
  getLang: () => HealthLang;
  onUnauthorized: () => void;
}

/**
 * The one place Mock or HTTP is chosen, by healthConfig's rule. The check is
 * written out rather than read from `healthConfig.mode` so that the bundler
 * can see it at build time and leave the mock and its sample records out of
 * builds that use the real backend.
 */
export function createHealthService({ getLang, onUnauthorized }: HealthServiceDeps): HealthService {
  if (process.env.EXPO_PUBLIC_HEALTH_API === 'mock' || (__DEV__ && process.env.EXPO_PUBLIC_HEALTH_API !== 'http')) {
    // A require, not an import, so it can sit behind the build-time check above.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { MockHealthService } = require('./mockHealthService') as typeof import('./mockHealthService');
    return new MockHealthService({ getLang });
  }
  return new HttpHealthService({ getToken: getSessionToken, getLang, onUnauthorized });
}
