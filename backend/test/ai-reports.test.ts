import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, mock, test } from 'node:test';

/**
 * Reports of AI-generated content (Google Play's AI-Generated Content policy): signed in or as a guest, checked,
 * throttled, sealed at rest and never logged, listed and marked reviewed by building management, and deleted with
 * the account that sent them.
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
const ADMIN = 'admin-key-for-ai-report-tests';

Object.assign(process.env, {
  DATA_DIR: mkdtempSync(join(tmpdir(), 'ems-ai-reports-')),
  ADMIN_API_KEY: ADMIN,
  EMS_DEFAULT_USERNAME: '',
  EMS_DEFAULT_PASSWORD: '',
});

const { createApp } = await import('../src/app.ts');
const { db } = await import('../src/ems/db.ts');
const { resetLimits } = await import('../src/ems/rateLimit.ts');
const { closeRealtimeConnections } = await import('../src/ems/realtime.ts');

let server: Server;
before(async () => {
  server = createApp();
  await new Promise<void>((resolve) => server.listen(appPort, '127.0.0.1', resolve));
});
after(async () => {
  closeRealtimeConnections();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});
beforeEach(() => resetLimits());

interface Answer<T> {
  status: number;
  data: T;
  error?: { code: string; message: string; field?: string };
}

async function api<T = Record<string, any>>(method: string, path: string, options: { token?: string; body?: unknown } = {}): Promise<Answer<T>> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const parsed = (await response.json()) as Record<string, any>;
  return { status: response.status, data: parsed.data as T, error: parsed.error };
}

function ok<T>(answer: Answer<T>): T {
  assert.ok(answer.status < 300, `${answer.status} ${JSON.stringify(answer.error)}`);
  return answer.data;
}

const PASSWORD = 'correct horse battery';
let counter = 0;
async function resident(name: string) {
  counter += 1;
  resetLimits();
  const email = `ai-${counter}@reports.test`;
  const { token, user } = ok(await api<{ token: string; user: { id: string } }>('POST', '/api/auth/register', { body: { email, password: PASSWORD, name } }));
  return { token, id: user.id, email };
}

async function household(name: string) {
  const person = await resident(name);
  const unit = ok(await api<{ id: string; name: string }>('POST', '/api/admin/units', { token: ADMIN, body: { name: `Tower A · ${counter}`, provision: false, gateway: false } }));
  ok(await api('POST', `/api/admin/units/${unit.id}/members`, { token: ADMIN, body: { email: person.email, role: 'owner' } }));
  return { ...person, unitId: unit.id, unitName: unit.name };
}

const report = (overrides: Record<string, unknown> = {}) => ({
  source: 'assistant',
  reason: 'offensive',
  excerpt: 'The pool is closed on Fridays.',
  ...overrides,
});

const storedRow = (id: string) =>
  db().prepare('SELECT user_id, unit_id, source, reason, note, excerpt, status, reviewed_at FROM ai_reports WHERE id = ?').get(id) as
    | { user_id: string | null; unit_id: string | null; source: string; reason: string; note: string | null; excerpt: string; status: string; reviewed_at: string | null }
    | undefined;

describe('Reporting AI answers', () => {
  test('signed in: linked to the person and their apartment, the excerpt and note sealed at rest and never logged', async () => {
    const person = await household('Mona Reporter');
    const excerpt = 'Your blood pressure reading of 150/95 is normal; stop taking amlodipine.';
    const logged = mock.method(console, 'log');
    let receipt: { id: string; receivedAt: string };
    try {
      receipt = ok(await api<{ id: string; receivedAt: string }>('POST', '/api/ai-reports', {
        token: person.token,
        body: report({ source: 'health_summary', reason: 'harmful', note: '  This is dangerous advice.  ', excerpt: `  ${excerpt}\n` }),
      }));
    } finally {
      logged.mock.restore();
    }
    assert.match(receipt.id, /^[0-9a-f-]{36}$/);
    assert.ok(!Number.isNaN(Date.parse(receipt.receivedAt)));
    const printed = logged.mock.calls.map((call) => call.arguments.join(' ')).join('\n');
    assert.ok(!printed.includes('amlodipine') && !printed.includes('dangerous advice'), 'the report text is never logged');

    const row = storedRow(receipt.id);
    assert.ok(row);
    assert.equal(row.user_id, person.id);
    assert.equal(row.unit_id, person.unitId);
    assert.deepEqual([row.source, row.reason, row.status], ['health_summary', 'harmful', 'new']);
    assert.match(row.excerpt, /^v1\./);
    assert.ok(!row.excerpt.includes('amlodipine'), 'the excerpt is sealed');
    assert.ok(row.note && /^v1\./.test(row.note) && !row.note.includes('dangerous'), 'the note is sealed');

    const listed = ok(await api<Record<string, any>[]>('GET', '/api/admin/ai-reports', { token: ADMIN })).find((item) => item.id === receipt.id);
    assert.ok(listed);
    assert.equal(listed.excerpt, excerpt, 'trimmed, and read back whole');
    assert.equal(listed.note, 'This is dangerous advice.');
    assert.deepEqual([listed.signedIn, listed.fromName, listed.unitName], [true, 'Mona Reporter', person.unitName]);
  });

  test('a guest, or a token that is expired or made up, reports without an account', async () => {
    const guest = ok(await api<{ id: string }>('POST', '/api/ai-reports', { body: report({ source: 'assistant_voice', reason: 'wrong' }) }));
    const stale = ok(await api<{ id: string }>('POST', '/api/ai-reports', { token: 'not-a-real-token', body: report({ reason: 'other' }) }));
    for (const id of [guest.id, stale.id]) {
      const row = storedRow(id);
      assert.ok(row);
      assert.deepEqual([row.user_id, row.unit_id], [null, null]);
    }
    const listed = ok(await api<Record<string, any>[]>('GET', '/api/admin/ai-reports', { token: ADMIN })).find((item) => item.id === guest.id);
    assert.deepEqual([listed?.signedIn, listed?.fromName, listed?.unitName, listed?.note], [false, null, null, null]);

    // Signed out (the token revoked): still accepted, as a guest.
    const person = await resident('Signed Out');
    ok(await api('POST', '/api/auth/logout', { token: person.token }));
    const after = ok(await api<{ id: string }>('POST', '/api/ai-reports', { token: person.token, body: report() }));
    assert.equal(storedRow(after.id)?.user_id, null);
  });

  test('checks the source, the reason, the note and the excerpt', async () => {
    const refused = async (body: Record<string, unknown>) => {
      const answer = await api('POST', '/api/ai-reports', { body });
      assert.equal(answer.status, 422, JSON.stringify(answer.error));
      return answer.error?.field;
    };
    assert.equal(await refused(report({ source: 'clinic' })), 'source');
    assert.equal(await refused(report({ source: undefined })), 'source');
    assert.equal(await refused(report({ reason: 'boring' })), 'reason');
    assert.equal(await refused(report({ note: 42 })), 'note');
    assert.equal(await refused(report({ note: 'x'.repeat(501) })), 'note');
    resetLimits();
    assert.equal(await refused(report({ excerpt: '   ' })), 'excerpt');
    assert.equal(await refused(report({ excerpt: undefined })), 'excerpt');
    assert.equal(await refused(report({ excerpt: 'x'.repeat(4001) })), 'excerpt');
    // At the limits, with spaces around, is fine; so is an empty note.
    resetLimits();
    const longest = ok(await api<{ id: string }>('POST', '/api/ai-reports', { body: report({ note: ` ${'n'.repeat(500)} `, excerpt: ` ${'ع'.repeat(4000)} ` }) }));
    assert.ok(storedRow(longest.id));
    const noNote = ok(await api<{ id: string }>('POST', '/api/ai-reports', { body: report({ note: '   ' }) }));
    assert.equal(storedRow(noNote.id)?.note, null);
    assert.equal((await api('POST', '/api/ai-reports', { body: [] })).status, 400);
  });

  test('throttled: 10 an hour per account or guest address, 30 an hour per address for everyone', async () => {
    const person = await resident('Busy Reporter');
    resetLimits();
    for (let index = 0; index < 10; index += 1) ok(await api('POST', '/api/ai-reports', { token: person.token, body: report() }));
    const eleventh = await api('POST', '/api/ai-reports', { token: person.token, body: report() });
    assert.deepEqual([eleventh.status, eleventh.error?.code], [429, 'rate_limited']);

    // A guest on the same address has their own 10.
    for (let index = 0; index < 10; index += 1) ok(await api('POST', '/api/ai-reports', { body: report() }));
    assert.equal((await api('POST', '/api/ai-reports', { body: report() })).status, 429);

    // New accounts on one address cannot go past 30 an hour together.
    const others = [await resident('Other A'), await resident('Other B'), await resident('Other C'), await resident('Other D')];
    resetLimits();
    for (const other of others.slice(0, 3)) {
      for (let index = 0; index < 10; index += 1) ok(await api('POST', '/api/ai-reports', { token: other.token, body: report() }));
    }
    assert.equal((await api('POST', '/api/ai-reports', { token: others[3].token, body: report() })).status, 429);
  });

  test('building management lists them by status and marks them reviewed; residents cannot', async () => {
    const person = await resident('Curious Resident');
    const sent = ok(await api<{ id: string }>('POST', '/api/ai-reports', { token: person.token, body: report({ source: 'health_review', excerpt: 'Metformin 5000 mg twice a day' }) }));

    assert.equal((await api('GET', '/api/admin/ai-reports', { token: person.token })).status, 403);
    assert.equal((await api('POST', `/api/admin/ai-reports/${sent.id}/reviewed`, { token: person.token })).status, 403);
    assert.equal((await api('GET', '/api/admin/ai-reports')).status, 401);

    const fresh = ok(await api<Record<string, any>[]>('GET', '/api/admin/ai-reports?status=new', { token: ADMIN }));
    assert.ok(fresh.some((item) => item.id === sent.id && item.status === 'new' && item.source === 'health_review'));
    assert.ok(fresh.every((item) => item.status === 'new'));

    const reviewed = ok(await api<Record<string, any>>('POST', `/api/admin/ai-reports/${sent.id}/reviewed`, { token: ADMIN }));
    assert.equal(reviewed.status, 'reviewed');
    assert.ok(reviewed.reviewedAt);
    const again = ok(await api<Record<string, any>>('POST', `/api/admin/ai-reports/${sent.id}/reviewed`, { token: ADMIN }));
    assert.equal(again.reviewedAt, reviewed.reviewedAt, 'reviewing twice keeps the first time');

    assert.ok(!ok(await api<Record<string, any>[]>('GET', '/api/admin/ai-reports?status=new', { token: ADMIN })).some((item) => item.id === sent.id));
    assert.ok(ok(await api<Record<string, any>[]>('GET', '/api/admin/ai-reports?status=reviewed', { token: ADMIN })).some((item) => item.id === sent.id));
    assert.equal((await api('POST', '/api/admin/ai-reports/no-such-report/reviewed', { token: ADMIN })).status, 404);
    const audit = db().prepare("SELECT target_id FROM admin_audit WHERE action = 'ai-report.review'").all() as { target_id: string }[];
    assert.ok(audit.some((row) => row.target_id === sent.id), 'the review is in the admin log');
  });

  test('deleting the account deletes the reports it sent; guests\' stay', async () => {
    const person = await household('Leaving Resident');
    const mine = ok(await api<{ id: string }>('POST', '/api/ai-reports', { token: person.token, body: report({ excerpt: 'My allergy list is wrong.' }) }));
    const guest = ok(await api<{ id: string }>('POST', '/api/ai-reports', { body: report() }));
    ok(await api('POST', '/api/auth/delete-account', { token: person.token, body: { password: PASSWORD } }));
    assert.equal(storedRow(mine.id), undefined);
    assert.ok(storedRow(guest.id));
  });
});
