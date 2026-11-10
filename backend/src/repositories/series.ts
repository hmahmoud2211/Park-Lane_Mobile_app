import { db } from '../ems/db.ts';

/** The bms_readings and unit_energy tables (migration 19). Column names are fixed here, never taken from a request. */

export const BMS_COLUMNS = [
  'kw_x10', 'kwh_x10', 'solar_kw_x10', 'solar_kwh_x10', 'grid_cost', 'solar_saving', 'mdb_volts', 'mdb_amps_x10', 'generator', 'fuel_pct',
  'water_tank_pct', 'water_flow_x10', 'pumps', 'co2_ppm', 'temp_x10', 'humidity_pct', 'fans', 'net_down_kbps', 'net_up_kbps', 'ping_ms',
  'uptime_x100', 'cameras_online', 'cameras_total', 'elevator_state', 'elevator_floor', 'fire_panel', 'gates', 'fault_code',
] as const;
export const ENERGY_COLUMNS = ['total_wh', 'lighting_wh', 'ac_wh', 'media_wh', 'other_wh'] as const;

export type BmsRow = { site_key: number; slot: number; source: number } & Record<(typeof BMS_COLUMNS)[number], number>;
export type EnergyRow = { unit_key: number; slot: number; source: number } & Record<(typeof ENERGY_COLUMNS)[number], number>;

function upsertStatement(table: 'bms_readings' | 'unit_energy') {
  const key = table === 'bms_readings' ? 'site_key' : 'unit_key';
  const columns = table === 'bms_readings' ? BMS_COLUMNS : ENERGY_COLUMNS;
  const names = [key, 'slot', 'source', ...columns];
  return db().prepare(
    `INSERT INTO ${table} (${names.join(', ')}) VALUES (${names.map(() => '?').join(', ')})
     ON CONFLICT(${key}, slot) DO UPDATE SET ${['source', ...columns].map((name) => `${name} = excluded.${name}`).join(', ')}`,
  );
}

export function upsertBmsRows(rows: readonly BmsRow[]): void {
  const statement = upsertStatement('bms_readings');
  for (const row of rows) statement.run(row.site_key, row.slot, row.source, ...BMS_COLUMNS.map((column) => row[column]));
}

export function upsertEnergyRows(rows: readonly EnergyRow[]): void {
  const statement = upsertStatement('unit_energy');
  for (const row of rows) statement.run(row.unit_key, row.slot, row.source, ...ENERGY_COLUMNS.map((column) => row[column]));
}

/** The newest row at or before `slot`: rows ahead of time exist but are never read. */
export function latestBms(siteKey: number, slot: number): BmsRow | undefined {
  return db().prepare('SELECT * FROM bms_readings WHERE site_key = ? AND slot <= ? ORDER BY slot DESC LIMIT 1').get(siteKey, slot) as BmsRow | undefined;
}

export function latestEnergy(unitKey: number, slot: number): EnergyRow | undefined {
  return db().prepare('SELECT * FROM unit_energy WHERE unit_key = ? AND slot <= ? ORDER BY slot DESC LIMIT 1').get(unitKey, slot) as EnergyRow | undefined;
}

export function bmsRange(siteKey: number, from: number, to: number): BmsRow[] {
  return db().prepare('SELECT * FROM bms_readings WHERE site_key = ? AND slot >= ? AND slot <= ? ORDER BY slot').all(siteKey, from, to) as unknown as BmsRow[];
}

export function energyRange(unitKey: number, from: number, to: number): EnergyRow[] {
  return db().prepare('SELECT * FROM unit_energy WHERE unit_key = ? AND slot >= ? AND slot <= ? ORDER BY slot').all(unitKey, from, to) as unknown as EnergyRow[];
}

/** Sums of the apartment's energy over [from, to]. */
export function energyTotals(unitKey: number, from: number, to: number): Record<(typeof ENERGY_COLUMNS)[number], number> & { slots: number } {
  return db()
    .prepare(
      `SELECT COUNT(*) AS slots, ${ENERGY_COLUMNS.map((column) => `COALESCE(SUM(${column}), 0) AS ${column}`).join(', ')}
       FROM unit_energy WHERE unit_key = ? AND slot >= ? AND slot <= ?`,
    )
    .get(unitKey, from, to) as Record<(typeof ENERGY_COLUMNS)[number], number> & { slots: number };
}

/** Series keys that have a row at exactly this slot (who to tell when it becomes current). */
export function siteKeysAt(slot: number): number[] {
  return (db().prepare('SELECT site_key FROM bms_readings WHERE slot = ?').all(slot) as { site_key: number }[]).map((row) => row.site_key);
}

export function unitKeysAt(slot: number): number[] {
  return (db().prepare('SELECT unit_key FROM unit_energy WHERE slot = ?').all(slot) as { unit_key: number }[]).map((row) => row.unit_key);
}

export function countRows(table: 'bms_readings' | 'unit_energy', key: number): number {
  const column = table === 'bms_readings' ? 'site_key' : 'unit_key';
  return (db().prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE ${column} = ?`).get(key) as { n: number }).n;
}

/** The unit's compact series key, assigned the first time it is needed. */
export function unitSeriesKey(unitId: string): number {
  const row = db().prepare('SELECT series_key FROM units WHERE id = ?').get(unitId) as { series_key: number | null } | undefined;
  if (!row) throw new Error(`No unit ${unitId}`);
  if (row.series_key !== null) return row.series_key;
  const next = (db().prepare('SELECT COALESCE(MAX(series_key), 0) + 1 AS next FROM units').get() as { next: number }).next;
  db().prepare('UPDATE units SET series_key = ? WHERE id = ? AND series_key IS NULL').run(next, unitId);
  return (db().prepare('SELECT series_key FROM units WHERE id = ?').get(unitId) as { series_key: number }).series_key;
}

export function findUnitIdBySeriesKey(key: number): string | undefined {
  return (db().prepare('SELECT id FROM units WHERE series_key = ?').get(key) as { id: string } | undefined)?.id;
}

export function findSiteIdBySeriesKey(key: number): string | undefined {
  return (db().prepare('SELECT id FROM sites WHERE series_key = ?').get(key) as { id: string } | undefined)?.id;
}

/** Units on a site, for the generator. */
export function unitIdsOfSite(siteId: string): string[] {
  return (db().prepare('SELECT id FROM units WHERE site_id = ? ORDER BY name').all(siteId) as { id: string }[]).map((row) => row.id);
}

/** Residents on compounds that are not demo sites: real people the generator must not mix sample data with. */
export function countRealResidents(): number {
  return (
    db()
      .prepare("SELECT COUNT(*) AS n FROM unit_members JOIN units ON units.id = unit_members.unit_id JOIN sites ON sites.id = units.site_id WHERE sites.kind != 'demo'")
      .get() as { n: number }
  ).n;
}
