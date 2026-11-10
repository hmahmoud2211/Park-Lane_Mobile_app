import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, beforeEach, describe, mock, test } from 'node:test';

/**
 * Phase 2 of the real backend: My Unit and Bills (finance worked out from records, owners only), visitor passes
 * (rules, the gate, revoking, retention) and parcels.
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
const ADMIN = 'admin-key-for-phase-2-tests';

Object.assign(process.env, {
  DATA_DIR: mkdtempSync(join(tmpdir(), 'ems-phase2-')),
  ADMIN_API_KEY: ADMIN,
  EMS_DEFAULT_USERNAME: '',
  EMS_DEFAULT_PASSWORD: '',
});

/** Monday 2 November 2026, 08:00 in Cairo (UTC+2). */
const cairo = (date: string, time: string) => Date.parse(`${date}T${time}:00+02:00`);
mock.timers.enable({ apis: ['Date'], now: cairo('2026-11-02', '08:00') });

const { createApp } = await import('../src/app.ts');
const { db } = await import('../src/ems/db.ts');
const { createUser } = await import('../src/ems/auth.ts');
const { resetLimits } = await import('../src/ems/rateLimit.ts');
const { closeRealtimeConnections } = await import('../src/ems/realtime.ts');
const { purgeOldPasses } = await import('../src/visitors/passes.ts');

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

interface Answer<T> {
  status: number;
  data: T;
  error?: { code: string; message: string; field?: string };
}

async function api<T = Record<string, any>>(method: string, path: string, options: { token?: string; body?: unknown; raw?: Buffer } = {}): Promise<Answer<T>> {
  const response = await fetch(path.startsWith('http') ? path : `${BASE}${path}`, {
    method,
    headers: {
      ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
    },
    body: options.raw ? new Uint8Array(options.raw) : options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  if (!(response.headers.get('content-type') ?? '').includes('json')) {
    return { status: response.status, data: Buffer.from(await response.arrayBuffer()) as unknown as T };
  }
  const parsed = (await response.json()) as Record<string, any>;
  return { status: response.status, data: parsed.data as T, error: parsed.error };
}

function ok<T>(answer: Answer<T>): T {
  assert.ok(answer.status < 300, `${answer.status} ${JSON.stringify(answer.error)}`);
  return answer.data;
}

let counter = 0;
async function resident(name: string) {
  counter += 1;
  resetLimits();
  const email = `p2-${counter}@phase2.test`;
  const { token, user } = ok(await api<{ token: string; user: { id: string } }>('POST', '/api/auth/register', { body: { email, password: 'correct horse battery', name } }));
  return { token, id: user.id, email };
}
type Person = Awaited<ReturnType<typeof resident>>;

async function apartment(name: string, owner: Person, ...members: Person[]) {
  const unit = ok(await api<{ id: string }>('POST', '/api/admin/units', { token: ADMIN, body: { name, provision: false, gateway: false } }));
  ok(await api('POST', `/api/admin/units/${unit.id}/members`, { token: ADMIN, body: { email: owner.email, role: 'owner' } }));
  for (const member of members) ok(await api('POST', `/api/admin/units/${unit.id}/members`, { token: ADMIN, body: { email: member.email, role: 'member' } }));
  return unit.id;
}

async function gateStaff() {
  const email = `gate-${++counter}@phase2.test`;
  await createUser(email, 'gate staff password', 'Gate', 'security');
  resetLimits();
  return ok(await api<{ token: string }>('POST', '/api/auth/login', { body: { email, password: 'gate staff password' } })).token;
}

const notificationsOf = (userId: string) =>
  db().prepare('SELECT kind, title FROM notifications WHERE user_id = ? ORDER BY created_at').all(userId) as { kind: string; title: string }[];

const EGP = (pounds: number) => pounds * 100;

describe('My Unit and Bills', () => {
  test('details, a contract with its schedule, payments and the figures the owner sees', async () => {
    const owner = await resident('Ahmed Owner');
    const family = await resident('Laila Member');
    const unitId = await apartment('Tower A · 302', owner, family);

    ok(await api('PUT', `/api/admin/units/${unitId}/details`, { token: ADMIN, body: { tower: 'A', floor: 3, number: '302', unitType: 'Apartment', bedrooms: 3, bathrooms: 2, areaM2: 186, parkingBay: 'P1-27', handoverStatus: 'Handed over' } }));
    const created = ok(await api<{ charges: number }>('POST', `/api/admin/units/${unitId}/contracts`, {
      token: ADMIN,
      body: { kind: 'sale', price: EGP(8_500_000), signedOn: '2024-03-01', schedule: { downPayment: EGP(1_175_000), downPaymentDueOn: '2024-03-05', installments: 30, firstDueOn: '2024-04-05', everyMonths: 1 } },
    }));
    assert.equal(created.charges, 31);
    const charges = db().prepare("SELECT kind, amount, due_on FROM unit_charges WHERE unit_id = ? ORDER BY due_on").all(unitId) as { kind: string; amount: number; due_on: string }[];
    assert.equal(charges.reduce((sum, row) => sum + row.amount, 0), EGP(8_500_000));
    assert.equal(charges.at(-1)?.due_on, '2026-09-05');

    // Down payment and the first two installments, as management records them.
    const finance0 = ok(await api<Record<string, any>>('GET', `/api/admin/units/${unitId}/finance`, { token: ADMIN }));
    const byTitle = (title: string) => finance0.charges.find((charge: { title: string }) => charge.title === title);
    const receipts: string[] = [];
    for (const title of ['Down payment', 'Installment 1 of 30', 'Installment 2 of 30']) {
      const charge = byTitle(title);
      receipts.push(ok(await api<{ receiptNo: string }>('POST', `/api/admin/units/${unitId}/payments`, { token: ADMIN, body: { chargeId: charge.id, amount: charge.amount, paidOn: '2026-10-01', method: 'bank_transfer' } })).receiptNo);
    }
    assert.deepEqual(receipts, ['RCP-2026-00001', 'RCP-2026-00002', 'RCP-2026-00003']);
    const over = await api('POST', `/api/admin/units/${unitId}/payments`, { token: ADMIN, body: { chargeId: byTitle('Installment 3 of 30').id, amount: EGP(1_000_000), paidOn: '2026-10-01', method: 'cash' } });
    assert.equal(over.status, 422);
    assert.equal(over.error?.field, 'amount');

    const overview = ok(await api<Record<string, any>>('GET', '/api/unit/overview', { token: owner.token }));
    assert.equal(overview.details.parkingBay, 'P1-27');
    assert.equal(overview.details.myRole, 'owner');
    const paid = EGP(1_175_000) + 2 * byTitle('Installment 1 of 30').amount;
    assert.equal(overview.finance.contract.paid, paid);
    assert.equal(overview.finance.contract.remaining, EGP(8_500_000) - paid);
    assert.equal(overview.finance.remainingInstallments, 28);
    assert.equal(overview.finance.nextInstallment.title, 'Installment 3 of 30');
    assert.equal(overview.finance.nextInstallment.status, 'overdue');
    assert.ok(notificationsOf(owner.id).some((n) => n.title === 'Payment received'));
    assert.ok(!notificationsOf(family.id).some((n) => n.title === 'Payment received'), 'members are not told about money');

    // A member sees the unit but not its money.
    const asMember = ok(await api<Record<string, any>>('GET', '/api/unit/overview', { token: family.token }));
    assert.equal(asMember.finance, null);
    assert.equal(asMember.details.myRole, 'member');
    assert.equal((await api('GET', '/api/unit/charges', { token: family.token })).status, 403);
  });

  test('bills: statuses from the payments, cancelling, and payments for another unit refused', async () => {
    const owner = await resident('Bill Owner');
    const unitId = await apartment('Tower B · 101', owner);
    const otherOwner = await resident('Other Owner');
    const otherUnit = await apartment('Tower B · 102', otherOwner);
    const service = ok(await api<{ id: string; reference: string }>('POST', `/api/admin/units/${unitId}/charges`, { token: ADMIN, body: { kind: 'service_charge', title: 'Service charge Q4', dueOn: '2026-10-15', amount: EGP(4500) } }));
    assert.match(service.reference, /^INV-2026-\d{5}$/);
    const water = ok(await api<{ id: string }>('POST', `/api/admin/units/${unitId}/charges`, { token: ADMIN, body: { kind: 'water', title: 'Water October', period: '2026-10', dueOn: '2026-11-20', amount: EGP(310) } }));
    ok(await api('POST', `/api/admin/units/${unitId}/charges`, { token: ADMIN, body: { kind: 'electricity', title: 'Electricity October', period: '2026-10', dueOn: '2026-11-20', amount: EGP(980) } }));
    ok(await api('POST', `/api/admin/units/${unitId}/payments`, { token: ADMIN, body: { chargeId: service.id, amount: EGP(2000), paidOn: '2026-10-20', method: 'cash' } }));
    ok(await api('POST', `/api/admin/units/${unitId}/payments`, { token: ADMIN, body: { chargeId: water.id, amount: EGP(310), paidOn: '2026-11-01', method: 'card_at_office' } }));

    const bills = ok(await api<{ title: string; status: string; outstanding: number }[]>('GET', '/api/unit/charges?group=bills', { token: owner.token }));
    const status = Object.fromEntries(bills.map((bill) => [bill.title, bill.status]));
    assert.deepEqual(status, { 'Water October': 'paid', 'Electricity October': 'due', 'Service charge Q4': 'overdue' });
    const overview = ok(await api<Record<string, any>>('GET', '/api/unit/overview', { token: owner.token }));
    assert.deepEqual(overview.finance.serviceCharges, { year: 2026, total: EGP(4500), paid: EGP(2000), outstanding: EGP(2500), nextDueOn: '2026-10-15' });

    assert.equal((await api('POST', `/api/admin/charges/${service.id}/void`, { token: ADMIN })).status, 409, 'a charge with payments stays');
    const extra = ok(await api<{ id: string }>('POST', `/api/admin/units/${unitId}/charges`, { token: ADMIN, body: { kind: 'other', title: 'Key copy', dueOn: '2026-11-10', amount: EGP(150) } }));
    assert.deepEqual(ok(await api('POST', `/api/admin/charges/${extra.id}/void`, { token: ADMIN })), { voided: true });
    const cross = await api('POST', `/api/admin/units/${otherUnit}/payments`, { token: ADMIN, body: { chargeId: water.id, amount: EGP(10), paidOn: '2026-11-01', method: 'cash' } });
    assert.equal(cross.status, 422);
    assert.equal(cross.error?.field, 'chargeId');
    assert.equal((await api('PUT', `/api/admin/units/${unitId}/details`, { token: owner.token, body: { floor: 9 } })).status, 403, 'residents never write finance or details');
  });

  test('meter readings show this month against the last', async () => {
    const owner = await resident('Meter Owner');
    const unitId = await apartment('Tower C · 7', owner);
    ok(await api('PUT', `/api/admin/units/${unitId}/meters`, { token: ADMIN, body: { readings: [{ meter: 'electricity', period: '2026-09', value: 382 }, { meter: 'electricity', period: '2026-10', value: 428 }, { meter: 'water', period: '2026-10', value: 31 }] } }));
    const bad = await api('PUT', `/api/admin/units/${unitId}/meters`, { token: ADMIN, body: { readings: [{ meter: 'gas', period: '2026-13', value: 3 }] } });
    assert.equal(bad.error?.field, 'readings.0.period');
    const meters = ok(await api<{ meters: { meter: string; current: { value: number } | null; changePercent: number | null }[] }>('GET', '/api/unit/overview', { token: owner.token })).meters;
    const electricity = meters.find((meter) => meter.meter === 'electricity');
    assert.equal(electricity?.current?.value, 428);
    assert.equal(electricity?.changePercent, 12);
    assert.equal(meters.find((meter) => meter.meter === 'water')?.changePercent, null);
  });

  test('documents: real file types only, opened by a member or a signed link, never by others', async () => {
    const owner = await resident('Doc Owner');
    const unitId = await apartment('Tower D · 1', owner);
    const stranger = await resident('Stranger');
    await apartment('Tower D · 2', stranger);
    const pdf = Buffer.from('%PDF-1.4\n% a floor plan\n');
    const uploaded = ok(await api<{ id: string; url: string; mime: string }>('POST', `/api/admin/units/${unitId}/documents?kind=floor_plan&title=Floor%20plan`, { token: ADMIN, raw: pdf }));
    assert.equal(uploaded.mime, 'application/pdf');
    const fake = await api('POST', `/api/admin/units/${unitId}/documents?kind=other&title=Script`, { token: ADMIN, raw: Buffer.from('<script>alert(1)</script>') });
    assert.equal(fake.status, 422);
    assert.equal(fake.error?.field, 'file');

    const viaLink = await fetch(uploaded.url.replace(/^https?:\/\/[^/]+/, BASE));
    assert.equal(viaLink.status, 200);
    assert.equal(viaLink.headers.get('x-content-type-options'), 'nosniff');
    assert.deepEqual(Buffer.from(await viaLink.arrayBuffer()), pdf);
    const path = `/api/unit/documents/${uploaded.id}/file`;
    assert.equal((await api('GET', path)).status, 404);
    assert.equal((await api('GET', path, { token: owner.token })).status, 200);
    assert.equal((await api('GET', path, { token: stranger.token })).status, 404);
  });
});

describe('visitor passes and the gate', () => {
  test('the compound\'s rules decide which passes can be made', async () => {
    const host = await resident('Host');
    await apartment('Tower E · 5', host);
    const make = (body: Record<string, unknown>) => api('POST', '/api/visitors', { token: host.token, body: { visitorName: 'Omar Khaled', guests: 1, ...body } });
    assert.equal((await make({ arrivesAt: new Date(cairo('2026-11-02', '23:00')).toISOString() })).error?.field, 'arrivesAt', 'after visiting hours');
    assert.equal((await make({ arrivesAt: new Date(cairo('2026-11-20', '12:00')).toISOString() })).error?.field, 'arrivesAt', 'too far ahead');
    assert.equal((await make({ arrivesAt: new Date(cairo('2026-11-02', '12:00')).toISOString(), guests: 11 })).error?.field, 'guests');
    assert.equal((await make({ arrivesAt: new Date(cairo('2026-11-02', '12:00')).toISOString(), visitorPhone: '12' })).error?.field, 'visitorPhone');
    assert.equal((await make({ arrivesAt: new Date(cairo('2026-11-02', '12:00')).toISOString(), uses: 'multi', lastDay: '2026-12-30' })).error?.field, 'lastDay');
  });

  test('a pass from making it to the visitor leaving, as both residents and the gate see it', async () => {
    const host = await resident('Mona Host');
    const partner = await resident('Karim Partner');
    await apartment('Tower F · 9', host, partner);
    const pass = ok(await api<{ id: string; code: string; status: string; createdByMe: boolean }>('POST', '/api/visitors', {
      token: host.token,
      body: { visitorName: 'Omar Khaled', visitorPhone: '+20 10 2233 4455', plate: 'egy 5678', guests: 2, arrivesAt: new Date(cairo('2026-11-02', '14:30')).toISOString() },
    }));
    assert.match(pass.code, /^PLV1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]+$/);
    assert.equal(pass.status, 'scheduled');
    const seenByPartner = ok(await api<{ id: string; createdByMe: boolean; plate: string; visitorName: string }[]>('GET', '/api/visitors', { token: partner.token }));
    assert.deepEqual(seenByPartner.map((p) => [p.id, p.createdByMe, p.plate, p.visitorName]), [[pass.id, false, 'EGY 5678', 'Omar Khaled']]);
    const stored = db().prepare('SELECT visitor_name, visitor_phone FROM visitor_passes WHERE id = ?').get(pass.id) as Record<string, string>;
    assert.ok(!stored.visitor_name.includes('Omar') && !stored.visitor_phone.includes('2233'), 'name and phone are sealed');

    const gate = await gateStaff();
    assert.equal((await api('POST', '/api/security/visitors/check', { token: host.token, body: { code: pass.code } })).status, 403, 'residents are not gate staff');
    assert.equal(ok(await api<{ decision: string }>('POST', '/api/security/visitors/check', { token: gate, body: { code: `${pass.code}x` } })).decision, 'unknown');
    assert.equal(ok(await api<{ decision: string }>('POST', '/api/security/visitors/check', { token: gate, body: { code: pass.code } })).decision, 'too_early');
    mock.timers.setTime(cairo('2026-11-02', '14:10'));
    const checked = ok(await api<{ decision: string; pass: { unitName: string; guests: number } }>('POST', '/api/security/visitors/check', { token: gate, body: { code: pass.code } }));
    assert.equal(checked.decision, 'admit');
    assert.equal(checked.pass.unitName, 'Tower F · 9');
    assert.equal(ok(await api<{ decision: string }>('POST', `/api/security/visitors/${pass.id}/entry`, { token: gate, body: { gate: 'Gate 1' } })).decision, 'exit');
    assert.equal((await api('POST', `/api/security/visitors/${pass.id}/entry`, { token: gate, body: {} })).status, 409, 'no second entry while inside');
    assert.ok(notificationsOf(host.id).some((n) => n.kind === 'visitors' && n.title === 'Omar Khaled arrived'));
    assert.ok(notificationsOf(partner.id).some((n) => n.title === 'Omar Khaled arrived'));
    const today = ok(await api<{ id: string; decision: string }[]>('GET', '/api/security/visitors/today', { token: gate }));
    assert.ok(today.some((p) => p.id === pass.id && p.decision === 'exit'));
    ok(await api('POST', `/api/security/visitors/${pass.id}/exit`, { token: gate, body: {} }));
    assert.equal(ok(await api<{ decision: string }>('POST', '/api/security/visitors/check', { token: gate, body: { code: pass.code } })).decision, 'used');
    const history = ok(await api<{ status: string; entries: { kind: string }[] }[]>('GET', '/api/visitors', { token: host.token }))[0];
    assert.equal(history.status, 'left');
    assert.deepEqual(history.entries.map((e) => e.kind), ['entry', 'exit']);
    mock.timers.setTime(cairo('2026-11-02', '08:00'));
  });

  test('a cancelled pass is refused at the gate; passes past the retention are removed', async () => {
    const host = await resident('Cancel Host');
    await apartment('Tower G · 3', host);
    const pass = ok(await api<{ id: string; code: string }>('POST', '/api/visitors', { token: host.token, body: { visitorName: 'Tarek Nabil', guests: 1, arrivesAt: new Date(cairo('2026-11-02', '10:00')).toISOString() } }));
    assert.equal(ok(await api<{ status: string }>('POST', `/api/visitors/${pass.id}/revoke`, { token: host.token })).status, 'revoked');
    const gate = await gateStaff();
    assert.equal(ok(await api<{ decision: string }>('POST', '/api/security/visitors/check', { token: gate, body: { code: pass.code } })).decision, 'revoked');
    assert.equal(purgeOldPasses(cairo('2026-11-02', '08:00') + 89 * 86_400_000), 0);
    assert.ok(purgeOldPasses(cairo('2026-11-02', '08:00') + 91 * 86_400_000) >= 1);
    assert.equal(db().prepare('SELECT 1 FROM visitor_passes WHERE id = ?').get(pass.id), undefined);
  });

  test('deleting the account removes its upcoming passes', async () => {
    const host = await resident('Leaving Host');
    await apartment('Tower H · 1', host);
    const pass = ok(await api<{ id: string }>('POST', '/api/visitors', { token: host.token, body: { visitorName: 'Guest', guests: 1, arrivesAt: new Date(cairo('2026-11-03', '10:00')).toISOString() } }));
    ok(await api('POST', '/api/auth/delete-account', { token: host.token, body: { password: 'correct horse battery' } }));
    assert.equal(db().prepare('SELECT 1 FROM visitor_passes WHERE id = ?').get(pass.id), undefined);
  });
});

describe('parcels', () => {
  test('the gate logs a parcel, the unit is told and sees it, and it is handed over once', async () => {
    const owner = await resident('Parcel Owner');
    const unitId = await apartment('Tower J · 4', owner);
    const neighbour = await resident('Neighbour');
    await apartment('Tower J · 5', neighbour);
    const gate = await gateStaff();
    const units = ok(await api<{ id: string; name: string }[]>('GET', '/api/security/units', { token: gate }));
    assert.ok(units.some((unit) => unit.id === unitId && unit.name === 'Tower J · 4'));
    assert.ok(units.every((unit) => Object.keys(unit).join() === 'id,name'), 'names only');
    const parcel = ok(await api<{ id: string; reference: string }>('POST', '/api/security/parcels', { token: gate, body: { unitId, carrier: 'Aramex', description: '1 box' } }));
    assert.match(parcel.reference, /^PCL-2026-\d{5}$/);
    assert.ok(notificationsOf(owner.id).some((n) => n.kind === 'parcels'));
    assert.deepEqual(ok(await api<{ id: string; status: string }[]>('GET', '/api/parcels', { token: owner.token })).map((p) => [p.id, p.status]), [[parcel.id, 'waiting']]);
    assert.deepEqual(ok(await api<unknown[]>('GET', '/api/parcels', { token: neighbour.token })), []);
    assert.ok(ok(await api<{ id: string }[]>('GET', '/api/security/parcels', { token: gate })).some((p) => p.id === parcel.id));
    assert.equal(ok(await api<{ status: string }>('POST', `/api/security/parcels/${parcel.id}/collect`, { token: gate })).status, 'collected');
    assert.equal((await api('POST', `/api/security/parcels/${parcel.id}/collect`, { token: gate })).status, 409);
    assert.equal((await api('POST', '/api/security/parcels', { token: gate, body: { unitId: 'nowhere' } })).error?.field, 'unitId');
  });
});
