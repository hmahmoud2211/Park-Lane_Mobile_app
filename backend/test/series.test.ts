import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, mock, test } from 'node:test';
import { fileURLToPath } from 'node:url';

/**
 * Phase 6 of the real backend: quarter-hour series. Rows written ahead are served one quarter hour at a time;
 * ranges average by bucket; answers cache to the next quarter hour; the simulation never raises an alarm; and the
 * generator refuses anything but a demo site.
 */

async function freePort(): Promise<number> {
  const probe = createServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise((resolve) => probe.close(resolve));
  return port;
}

const appPort = await freePort();
const BASE = `http://127.0.0.1:${appPort}`;
const ADMIN = 'admin-key-for-phase-6-tests';
Object.assign(process.env, { DATA_DIR: mkdtempSync(join(tmpdir(), 'ems-phase6-')), ADMIN_API_KEY: ADMIN, EMS_DEFAULT_USERNAME: '', EMS_DEFAULT_PASSWORD: '' });

/** Tuesday 10 November 2026, 14:07 in Cairo. */
const NOW = Date.parse('2026-11-10T14:07:00+02:00');
mock.timers.enable({ apis: ['Date'], now: NOW });

const { createApp } = await import('../src/app.ts');
const { resetLimits } = await import('../src/ems/rateLimit.ts');
const { closeRealtimeConnections } = await import('../src/ems/realtime.ts');
const { insertSite } = await import('../src/repositories/sites.ts');
const { unitSeriesKey, upsertBmsRows, upsertEnergyRows } = await import('../src/repositories/series.ts');
const { bmsReading, slotOf, unitEnergy, SLOT_MS } = await import('../src/series/model.ts');
const { announceSlot } = await import('../src/series/api.ts');

let server: Server;
before(async () => {
  server = createApp();
  await new Promise<void>((resolve) => server.listen(appPort, '127.0.0.1', resolve));
});
after(async () => {
  closeRealtimeConnections();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  mock.timers.reset();
});
beforeEach(() => resetLimits());

async function api<T = Record<string, any>>(path: string, token?: string, headers: Record<string, string> = {}) {
  const response = await fetch(`${BASE}${path}`, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers } });
  const text = await response.text();
  const parsed = text ? (JSON.parse(text) as Record<string, any>) : {};
  return { status: response.status, data: parsed.data as T, error: parsed.error as { code: string; field?: string } | undefined, headers: response.headers };
}

async function post(path: string, body: unknown, token?: string) {
  const response = await fetch(`${BASE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
  return (await response.json()) as Record<string, any>;
}

let counter = 0;
async function residentIn(siteId: string) {
  counter += 1;
  resetLimits();
  const email = `p6-${counter}@phase6.test`;
  const registered = await post('/api/auth/register', { email, password: 'correct horse battery', name: `Resident ${counter}` });
  const unit = (await post('/api/admin/units', { name: `Demo · ${counter}`, provision: false, gateway: false, siteId }, ADMIN)).data;
  // Units made by the admin API join the default compound; move this one to the demo site.
  const { db } = await import('../src/ems/db.ts');
  db().prepare('UPDATE units SET site_id = ? WHERE id = ?').run(siteId, unit.id);
  await post(`/api/admin/units/${unit.id}/members`, { email, role: 'owner' }, ADMIN);
  return { token: registered.data.token as string, unitId: unit.id as string };
}

describe('Quarter-hour series', () => {
  const site = { id: 'demo-tests', key: 0 };
  let person: { token: string; unitId: string };

  before(async () => {
    site.key = insertSite({ id: site.id, name: 'Demo for tests', timezone: 'Africa/Cairo', kind: 'demo', createdAt: new Date(NOW).toISOString() }).seriesKey;
    person = await residentIn(site.id);
    const unitKey = unitSeriesKey(person.unitId);
    const now = slotOf(NOW);
    // Yesterday through tomorrow: rows for the future exist but must not be served.
    const slots = Array.from({ length: 96 * 3 }, (_, index) => now - 96 + index);
    upsertBmsRows(slots.map((slot) => ({ site_key: site.key, slot, source: 0, ...bmsReading(42, site.key, slot) })));
    upsertEnergyRows(slots.map((slot) => ({ unit_key: unitKey, slot, source: 0, ...unitEnergy(42, unitKey, slot) })));
  });

  test('the latest reading is the current quarter hour, never one written ahead; the next appears 15 minutes later', async () => {
    const first = await api<Record<string, any>>('/api/sites/me/bms/latest', person.token);
    assert.equal(first.status, 200);
    assert.equal(first.data.at, new Date(slotOf(NOW) * SLOT_MS).toISOString());
    assert.equal(first.data.source, 'simulated');
    assert.equal(first.data.reading.firePanel, 'normal');
    assert.ok(first.data.reading.health > 0 && first.data.reading.health <= 1);
    mock.timers.setTime(NOW + 15 * 60_000);
    const next = await api<Record<string, any>>('/api/sites/me/bms/latest', person.token);
    assert.equal(Date.parse(next.data.at) - Date.parse(first.data.at), 15 * 60_000);
    mock.timers.setTime(NOW);
  });

  test('answers cache until the next quarter hour, and a matching ETag gets 304', async () => {
    const answer = await api('/api/sites/me/bms/latest', person.token);
    const maxAge = Number(/max-age=(\d+)/.exec(answer.headers.get('cache-control') ?? '')?.[1]);
    assert.ok(maxAge > 0 && maxAge <= 900, `max-age ${maxAge}`);
    assert.equal(maxAge, 8 * 60, 'from 14:07 to 14:15');
    const again = await api('/api/sites/me/bms/latest', person.token, { 'If-None-Match': answer.headers.get('etag')! });
    assert.equal(again.status, 304);
  });

  test('ranges average by bucket, stop at now, and check their input', async () => {
    const hours = await api<Record<string, any>>(`/api/sites/me/bms/series?metrics=kw,co2&bucket=1h&from=${encodeURIComponent(new Date(NOW - 6 * 3600_000).toISOString())}&to=${encodeURIComponent(new Date(NOW + 6 * 3600_000).toISOString())}`, person.token);
    assert.equal(hours.status, 200);
    const last = Date.parse(hours.data.points.at(-1).at);
    assert.ok(last <= NOW, 'no point after now');
    assert.ok(hours.data.points.length >= 6 && hours.data.points.length <= 7);
    const point = hours.data.points[1];
    assert.ok(point.min.kw <= point.avg.kw && point.avg.kw <= point.max.kw);
    assert.equal((await api('/api/sites/me/bms/series?metrics=password', person.token)).error?.field, 'metrics');
    assert.equal((await api('/api/sites/me/bms/series?bucket=1y', person.token)).error?.field, 'bucket');
    const tooMany = await api(`/api/sites/me/bms/series?bucket=15m&from=2026-01-01T00:00:00Z&to=${encodeURIComponent(new Date(NOW).toISOString())}`, person.token);
    assert.equal(tooMany.error?.field, 'bucket');
  });

  test('the apartment\'s energy: this quarter, today since midnight, and its range', async () => {
    const latest = await api<Record<string, any>>('/api/units/me/energy/latest', person.token);
    assert.equal(latest.status, 200);
    assert.ok(latest.data.today.total >= latest.data.quarter.total);
    const sum = latest.data.today.lighting + latest.data.today.ac + latest.data.today.media + latest.data.today.other;
    assert.ok(Math.abs(sum - latest.data.today.total) < 0.05);
    const days = await api<Record<string, any>>('/api/units/me/energy/series?metrics=total&bucket=1d&from=2026-11-09T00:00:00%2B02:00', person.token);
    assert.equal(days.data.points.length, 2, 'yesterday and today, by Cairo\'s calendar');
  });

  test('an apartment with no readings gets none, never invented ones', async () => {
    resetLimits();
    const email = `p6-real-${++counter}@phase6.test`;
    const registered = await post('/api/auth/register', { email, password: 'correct horse battery', name: 'Real Resident' });
    const unit = (await post('/api/admin/units', { name: 'Tower A · 1', provision: false, gateway: false }, ADMIN)).data;
    await post(`/api/admin/units/${unit.id}/members`, { email, role: 'owner' }, ADMIN);
    assert.equal((await api('/api/units/me/energy/latest', registered.data.token)).data, null);
    assert.equal((await api('/api/sites/me/bms/latest', registered.data.token)).data, null);
  });

  test('the quarter-hour push names the compounds and apartments whose reading just became current', () => {
    const told = announceSlot(slotOf(NOW));
    assert.deepEqual(told, { sites: 1, units: 1 });
  });

  test('four years of the simulated building never raise an alarm', () => {
    const start = slotOf(Date.parse('2026-01-01T00:00:00+02:00'));
    let alarms = 0;
    for (let slot = start; slot < start + 140_256; slot += 1) {
      const reading = bmsReading(42, 1, slot);
      if (reading.fire_panel !== 0 || reading.gates !== 0) alarms += 1;
    }
    assert.equal(alarms, 0);
  });
});

describe('The generator script', () => {
  const script = fileURLToPath(new URL('../scripts/generate-series.ts', import.meta.url));
  const run = (dataDir: string, ...args: string[]) => spawnSync(process.execPath, [script, ...args], { env: { ...process.env, DATA_DIR: dataDir }, encoding: 'utf8' });

  test('refuses a site that is not a demo site; writes a demo site deterministically', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ems-generator-'));
    const refused = run(dir, '--site', 'park-lane', '--from', '2026-01-01', '--to', '2026-01-01');
    assert.equal(refused.status, 3);
    assert.match(refused.stderr, /not a demo site/);
    const made = run(dir, '--site', 'demo-x', '--create', 'Demo X', '--demo-units', '2', '--from', '2026-01-01', '--to', '2026-01-02 23:45', '--seed', '7');
    assert.equal(made.status, 0, made.stderr);
    assert.match(made.stdout, /Done: 192 building rows, 384 apartment rows/);
    const again = run(dir, '--site', 'demo-x', '--from', '2026-01-01', '--to', '2026-01-02 23:45', '--seed', '7');
    assert.match(again.stdout, /Done: 192 building rows, 384 apartment rows/);
  });
});
