/**
 * Fills the time-series tables with simulated quarter-hour readings for a demo compound and its apartments.
 *
 *   node scripts/generate-series.ts --site demo-park-lane --from 2026-01-01 --to "2029-12-31 23:45" \
 *     --seed 42 --units all [--create "Park Lane Demo" --demo-units 4] [--yes-i-am-sure]
 *
 * Rows go up to --to at once, but the API serves no slot after "now", so one new reading per series appears every
 * 15 minutes by itself. The rows are a pure function of (seed, series, slot) (src/series/model.ts): running it again
 * writes the same values, and stopping it half way and running it again simply finishes the job.
 *
 * Guards: the site must be a demo site (`sites.kind = 'demo'`), always. If the database has real residents (on any
 * compound that is not a demo site), it also needs --yes-i-am-sure. It never writes an alarm: the fire panel and the
 * gates always read normal, and nothing it writes sends a notification.
 */
import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { join } from 'node:path';

import { clinicInstant } from '../src/clinic/time.ts';
import { config } from '../src/config.ts';
import { db, transaction } from '../src/ems/db.ts';
import { findSite, insertSite } from '../src/repositories/sites.ts';
import { countRealResidents, unitIdsOfSite, unitSeriesKey, upsertBmsRows, upsertEnergyRows, type BmsRow, type EnergyRow } from '../src/repositories/series.ts';
import { insertUnit } from '../src/repositories/units.ts';
import { bmsReading, cairoTime, slotOf, unitEnergy } from '../src/series/model.ts';

function args(argv: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const name = argv[i];
    if (!name.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out.set(name.slice(2), 'true');
    else {
      out.set(name.slice(2), next);
      i += 1;
    }
  }
  return out;
}

function fail(code: number, message: string): never {
  console.error(`generate-series: ${message}`);
  process.exit(code);
}

/** "2026-01-01" or "2029-12-31 23:45", on Cairo's clock. */
function cairoInstant(value: string, field: string): number {
  const match = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?$/.exec(value.trim());
  if (!match) fail(2, `--${field} must look like 2026-01-01 or "2029-12-31 23:45".`);
  return clinicInstant(match[1], match[2] ?? '00:00', 'Africa/Cairo');
}

const options = args(process.argv.slice(2));
const siteId = options.get('site') ?? fail(2, 'Name the demo site with --site.');
const seed = Number(options.get('seed') ?? '42');
if (!Number.isInteger(seed)) fail(2, '--seed must be a whole number.');
const sure = options.get('yes-i-am-sure') === 'true';
const batchSize = Number(options.get('batch') ?? '5000');

// Checked before anything is written, the demo site included.
const realResidents = countRealResidents();
if (realResidents > 0 && !sure) {
  fail(3, `This database has ${realResidents} real resident(s). Writing sample data next to them needs --yes-i-am-sure (and --site must be a demo site).`);
}

let site = findSite(siteId);
if (!site && options.has('create')) {
  const name = options.get('create') === 'true' ? 'Park Lane Demo' : options.get('create')!;
  site = insertSite({ id: siteId, name, timezone: 'Africa/Cairo', kind: 'demo', createdAt: new Date().toISOString() });
  const count = Math.min(50, Math.max(0, Number(options.get('demo-units') ?? '3')));
  for (let index = 0; index < count; index += 1) {
    insertUnit({ id: randomUUID(), name: `Demo · A-${101 + index}`, building: 'A', createdAt: new Date().toISOString(), siteId });
  }
  console.log(`Created demo site "${name}" (${siteId}) with ${count} demo apartments.`);
}
if (!site) fail(2, `There is no site "${siteId}". Add --create "Name" to make a demo site.`);
if (site.kind !== 'demo') fail(3, `"${siteId}" is not a demo site. Simulated readings are only ever written for demo sites.`);

const from = slotOf(cairoInstant(options.get('from') ?? '2026-01-01', 'from'));
const to = slotOf(cairoInstant(options.get('to') ?? '2029-12-31 23:45', 'to'));
if (to < from) fail(2, '--to is before --from.');
const unitChoice = options.get('units') ?? 'all';
const unitIds = unitChoice === 'none' ? [] : unitChoice === 'all' ? unitIdsOfSite(siteId) : unitChoice.split(',').map((id) => id.trim()).filter(Boolean);
const unitKeys = unitIds.map((id) => ({ id, key: unitSeriesKey(id) }));

console.log(`Site ${siteId} (series ${site.seriesKey}), ${unitKeys.length} apartment(s), slots ${from}..${to} (${to - from + 1} quarter hours), seed ${seed}.`);
const started = performance.now();
let bmsRows: BmsRow[] = [];
let energyRows: EnergyRow[] = [];
let written = { bms: 0, energy: 0 };
let month = '';

function flush() {
  if (bmsRows.length === 0 && energyRows.length === 0) return;
  const bms = bmsRows;
  const energy = energyRows;
  transaction(() => {
    upsertBmsRows(bms);
    upsertEnergyRows(energy);
  });
  written = { bms: written.bms + bms.length, energy: written.energy + energy.length };
  bmsRows = [];
  energyRows = [];
}

for (let slot = from; slot <= to; slot += 1) {
  bmsRows.push({ site_key: site.seriesKey, slot, source: 0, ...bmsReading(seed, site.seriesKey, slot) });
  for (const unit of unitKeys) energyRows.push({ unit_key: unit.key, slot, source: 0, ...unitEnergy(seed, unit.key, slot) });
  if (bmsRows.length + energyRows.length >= batchSize) flush();
  const t = cairoTime(slot);
  const label = `${t.year}-${String(t.month + 1).padStart(2, '0')}`;
  if (label !== month) {
    if (month) console.log(`  ${month} done · ${written.bms + bmsRows.length} building + ${written.energy + energyRows.length} apartment rows`);
    month = label;
  }
}
flush();

db().exec('PRAGMA wal_checkpoint(TRUNCATE)');
const file = join(config.dataDir, 'ems.db');
const seconds = ((performance.now() - started) / 1000).toFixed(1);
console.log(`Done: ${written.bms} building rows, ${written.energy} apartment rows in ${seconds} s. Database file: ${(statSync(file).size / 1024 / 1024).toFixed(1)} MB (${file}).`);
