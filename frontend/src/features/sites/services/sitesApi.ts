import type { SiteSettings, SiteView } from '../../../../../shared/contracts/sites';
import { call } from '../../ems/services/emsHttp';

/** The resident's compound and the rules building management set for it (backend/src/routes/sites.ts). */
export const getMySite = () => call<{ site: SiteView; settings: SiteSettings }>('/api/sites/me', { retry: true });
