import { db } from '../ems/db.ts';

/** The sites, site_settings and reference_counters tables (migration 14). */

export type SiteKind = 'real' | 'demo';

export interface Site {
  id: string;
  name: string;
  timezone: string;
  kind: SiteKind;
  seriesKey: number;
  createdAt: string;
}

interface SiteRow {
  id: string;
  name: string;
  timezone: string;
  kind: string;
  series_key: number;
  created_at: string;
}

const toSite = (row: SiteRow): Site => ({
  id: row.id,
  name: row.name,
  timezone: row.timezone,
  kind: row.kind === 'demo' ? 'demo' : 'real',
  seriesKey: row.series_key,
  createdAt: row.created_at,
});

export function findSite(id: string): Site | null {
  const row = db().prepare('SELECT * FROM sites WHERE id = ?').get(id) as SiteRow | undefined;
  return row ? toSite(row) : null;
}

export function listSites(): Site[] {
  return (db().prepare('SELECT * FROM sites ORDER BY name').all() as unknown as SiteRow[]).map(toSite);
}

export function insertSite(site: Omit<Site, 'seriesKey'>): Site {
  const next = (db().prepare('SELECT COALESCE(MAX(series_key), 0) + 1 AS next FROM sites').get() as { next: number }).next;
  db()
    .prepare('INSERT INTO sites (id, name, timezone, kind, series_key, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(site.id, site.name, site.timezone, site.kind, next, site.createdAt);
  return { ...site, seriesKey: next };
}

/** How many residents live on the site: the generator refuses to write sample data where anyone does. */
export function countSiteResidents(siteId: string): number {
  return (
    db()
      .prepare('SELECT COUNT(*) AS n FROM unit_members JOIN units ON units.id = unit_members.unit_id WHERE units.site_id = ?')
      .get(siteId) as { n: number }
  ).n;
}

export function readSiteSettings(siteId: string): string | null {
  const row = db().prepare('SELECT settings FROM site_settings WHERE site_id = ?').get(siteId) as { settings: string } | undefined;
  return row?.settings ?? null;
}

export function writeSiteSettings(siteId: string, settings: string, at: string): void {
  db()
    .prepare(
      `INSERT INTO site_settings (site_id, settings, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(site_id) DO UPDATE SET settings = excluded.settings, updated_at = excluded.updated_at`,
    )
    .run(siteId, settings, at);
}

/**
 * The next number for a kind of reference on a site (and year, for references that restart yearly). Runs in the
 * caller's transaction, or as one statement: the UPSERT … RETURNING makes two callers never get the same number.
 */
export function takeReferenceNumber(siteId: string, kind: string, year: number): number {
  const row = db()
    .prepare(
      `INSERT INTO reference_counters (site_id, kind, year, next) VALUES (?, ?, ?, 2)
       ON CONFLICT(site_id, kind, year) DO UPDATE SET next = next + 1
       RETURNING next - 1 AS number`,
    )
    .get(siteId, kind, year) as { number: number };
  return row.number;
}
