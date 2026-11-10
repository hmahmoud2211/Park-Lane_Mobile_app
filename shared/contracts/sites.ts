/** A compound and the rules its building management sets (GET /api/sites/me, /api/admin/sites/:id/settings). */

export interface SiteView {
  id: string;
  name: string;
  timezone: string;
  /** 'demo' sites hold only generated sample data. */
  kind: 'real' | 'demo';
}

/** A time window on a day, in the site's time zone, as HH:MM. */
export interface DayWindow {
  from: string;
  to: string;
}

export interface SiteSettings {
  /** Maintenance's emergency button calls it; the button is hidden while it is unset. */
  emergencyPhone: string | null;
  /** How residents reach building management (Help & Support). */
  managementPhone: string | null;
  managementEmail: string | null;
  visitors: {
    /** First and last arrival time a pass may be made for, HH:MM. */
    earliest: string;
    latest: string;
    stepMinutes: number;
    /** Passes can be made for today and this many days ahead, minus one. */
    windowDays: number;
    maxGuests: number;
    /** Past passes (they hold visitors' names and phones) are deleted after this many days. */
    retentionDays: number;
  };
  maintenance: {
    windows: DayWindow[];
    /** The earliest preferred day is today plus this many days. */
    leadDays: number;
    horizonDays: number;
  };
  amenities: {
    windowDays: number;
    maxGuests: number;
  };
}

/** PUT /api/admin/sites/:id/settings: any part; the rest stays as it was. */
export interface SiteSettingsPatch {
  emergencyPhone?: string | null;
  managementPhone?: string | null;
  managementEmail?: string | null;
  visitors?: Partial<SiteSettings['visitors']>;
  maintenance?: Partial<SiteSettings['maintenance']>;
  amenities?: Partial<SiteSettings['amenities']>;
}
