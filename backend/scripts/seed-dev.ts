/**
 * A development seed: a demo compound with something in every feature, so the app and the dashboard can be walked
 * end to end on a local backend.
 *
 *   node scripts/seed-dev.ts [--site demo-park-lane] [--password "demo password 1"] [--no-series] [--yes-i-am-sure]
 *
 * It works only on a demo site (`sites.kind = 'demo'`, made here if missing), and refuses a database that has real
 * residents (on any compound that is not a demo site) unless --yes-i-am-sure is given. Every name, phone and plate is
 * made up; every account is on the demo site. Running it again adds nothing twice where it can tell (accounts,
 * apartments, the catalogue); a booking already made is refused rather than repeated, and requests and notices are
 * added again. Never run it against production.
 */
import { randomUUID } from 'node:crypto';

import { addAmenity } from './lib/seedAmenities.ts';
import { config } from '../src/config.ts';
import { createUser, type User } from '../src/ems/auth.ts';
import { transaction } from '../src/ems/db.ts';
import { createEvent, createPoll, publishAnnouncement } from '../src/community/community.ts';
import { bookAmenity } from '../src/amenities/amenities.ts';
import { bookParking } from '../src/parking/api.ts';
import { logParcel } from '../src/parcels/parcels.ts';
import { findSite, insertSite } from '../src/repositories/sites.ts';
import { countRealResidents, unitIdsOfSite, unitSeriesKey, upsertBmsRows, upsertEnergyRows } from '../src/repositories/series.ts';
import { findUnit, insertUnit, upsertMember } from '../src/repositories/units.ts';
import { findUserByEmail } from '../src/repositories/users.ts';
import { addTechnician, assignRequest, createRequest } from '../src/requests/serviceRequests.ts';
import { bmsReading, slotOf, unitEnergy } from '../src/series/model.ts';
import { addCharge, addContract, adminFinance, recordPayment, saveMeterReadings, setUnitDetails } from '../src/unit/finance.ts';
import { createPass } from '../src/visitors/passes.ts';

const argv = process.argv.slice(2);
const flag = (name: string) => argv.includes(`--${name}`);
const option = (name: string, fallback: string) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] && !argv[index + 1].startsWith('--') ? argv[index + 1] : fallback;
};
function fail(message: string): never {
  console.error(`seed-dev: ${message}`);
  process.exit(3);
}

const siteId = option('site', 'demo-park-lane');
const password = option('password', 'demo password 1');
const base = config.publicUrl || `http://localhost:${config.port}`;

const real = countRealResidents();
if (real > 0 && !flag('yes-i-am-sure')) fail(`This database has ${real} real resident(s). Seeding demo data next to them needs --yes-i-am-sure.`);
let site = findSite(siteId);
site ??= insertSite({ id: siteId, name: 'Park Lane Demo', timezone: 'Africa/Cairo', kind: 'demo', createdAt: new Date().toISOString() });
if (site.kind !== 'demo') fail(`"${siteId}" is not a demo site.`);

async function account(email: string, name: string, role: 'resident' | 'security' = 'resident'): Promise<User> {
  return findUserByEmail(email) ?? createUser(email, password, name, role);
}

function apartment(name: string, details: Record<string, unknown>): string {
  const existing = unitIdsOfSite(siteId).map((id) => findUnit(id)!).find((unit) => unit.name === name);
  const id = existing?.id ?? randomUUID();
  if (!existing) insertUnit({ id, name, building: String(details.tower ?? 'A'), createdAt: new Date().toISOString(), siteId });
  setUnitDetails(id, details);
  return id;
}

const now = Date.now();
const day = (offset: number) => new Date(now + offset * 86_400_000).toISOString().slice(0, 10);
const step = (label: string, work: () => unknown) => {
  try {
    work();
    console.log(`  ✓ ${label}`);
  } catch (error) {
    console.log(`  – ${label}: ${(error as Error).message}`);
  }
};

console.log(`Seeding demo site ${site.name} (${siteId})…`);
const owner = await account('demo.owner@example.com', 'Demo Owner');
const member = await account('demo.member@example.com', 'Demo Member');
const neighbour = await account('demo.neighbour@example.com', 'Demo Neighbour');
const gate = await account('demo.gate@example.com', 'Demo Gate', 'security');

const homeA = apartment('Demo · A-101', { tower: 'A', floor: 1, number: '101', unitType: 'Apartment', bedrooms: 3, bathrooms: 2, areaM2: 165, parkingBay: 'P2-148', handoverStatus: 'Handed over' });
const homeB = apartment('Demo · B-204', { tower: 'B', floor: 2, number: '204', unitType: 'Apartment', bedrooms: 2, bathrooms: 2, areaM2: 120, parkingBay: null, handoverStatus: 'Handed over' });
transaction(() => {
  upsertMember(homeA, owner.id, 'owner', new Date().toISOString());
  upsertMember(homeA, member.id, 'member', new Date().toISOString());
  upsertMember(homeB, neighbour.id, 'owner', new Date().toISOString());
});

step('My Unit: contract, payments, a bill and meters', () => {
  if (adminFinance(homeA, base).charges.length === 0) {
    addContract(homeA, { kind: 'sale', price: 6_200_000_00, signedOn: day(-400), schedule: { downPayment: 1_200_000_00, downPaymentDueOn: day(-395), installments: 24, firstDueOn: day(-360), everyMonths: 1 } });
    const charges = adminFinance(homeA, base).charges as { id: string; amount: number; dueOn: string }[];
    for (const charge of charges.filter((entry) => entry.dueOn < day(-30)).slice(0, 6)) recordPayment(homeA, { chargeId: charge.id, amount: charge.amount, paidOn: charge.dueOn, method: 'bank_transfer' }, null);
    addCharge(homeA, { kind: 'electricity', title: 'Electricity (last month)', period: day(-20).slice(0, 7), dueOn: day(10), amount: 1_240_00 });
  }
  saveMeterReadings(homeA, { readings: [{ meter: 'electricity', period: day(-40).slice(0, 7), value: 410 }, { meter: 'electricity', period: day(-10).slice(0, 7), value: 386 }, { meter: 'water', period: day(-10).slice(0, 7), value: 14 }] });
});
step('Visitors and a parcel', () => {
  createPass(owner, { visitorName: 'Sample Visitor', visitorPhone: '+20 100 000 0000', guests: 2, plate: 'DEMO 101', arrivesAt: new Date(Date.parse(`${day(1)}T16:00:00+02:00`)).toISOString() });
  logParcel(gate, { unitId: homeA, carrier: 'Demo Courier', description: '1 box' });
});
step('A maintenance request booked with a technician', () => {
  const technician = addTechnician(siteId, { name: 'Demo Technician', phone: '+20 100 000 0001', trades: ['plumbing', 'electrical'] });
  const request = createRequest(owner, { kind: 'maintenance', category: 'plumbing', title: 'Kitchen tap dripping', preferredDate: day(1), preferredWindow: '09:00-12:00' }, base);
  assignRequest(null, request.id, { technicianId: technician.id, scheduledDate: day(1), scheduledWindow: '10:00-12:00' }, base);
});
step('Community: a notice, an alert, an event and a poll', () => {
  publishAnnouncement(null, siteId, { kind: 'news', title: 'Welcome to the demo compound', body: 'Everything here is sample content for testing.', picture: 'gathering' });
  publishAnnouncement(null, siteId, { kind: 'alert', level: 'info', title: 'Pool cleaning on Thursday', body: 'The pool closes 08:00 to 12:00.', picture: 'pool' });
  createEvent(siteId, { title: 'Demo movie night', description: 'A family film on the lawn.', venue: 'Central garden', startsAt: new Date(now + 3 * 86_400_000).toISOString(), endsAt: new Date(now + 3 * 86_400_000 + 3 * 3600_000).toISOString(), capacity: 40, picture: 'movie' });
  createPoll(siteId, { question: 'Which activity should come first?', closesAt: new Date(now + 7 * 86_400_000).toISOString(), options: [{ label: 'More events', picture: 'events' }, { label: 'Fitness classes', picture: 'fitness' }, { label: 'Kids activities', picture: 'kids' }] });
});
step('Amenities: a catalogue and one booking', () => {
  const pool = addAmenity(siteId, { title: 'Swimming Pool', location: 'Residential Club', opens: '06:00', closes: '22:00', capacity: 20, maxPeople: 6, categories: ['sports', 'leisure', 'family'], picture: 'pool', sort: 1 });
  addAmenity(siteId, { title: 'Gym', location: 'Tower A · Level 1', opens: '05:00', closes: '23:00', capacity: 15, maxPeople: 2, categories: ['sports'], picture: 'gym', sort: 2 });
  addAmenity(siteId, { title: 'Multipurpose Hall', location: 'Tower B · Ground Floor', opens: '09:00', closes: '22:00', capacity: 50, maxPeople: 6, exclusive: true, categories: ['leisure', 'family'], picture: 'hall', sort: 3 });
  bookAmenity(owner, pool, { date: day(2), start: '10:00', people: 3 });
});
step('Parking: a guest booking', () => {
  const start = Math.ceil((now + 26 * 3600_000) / 900_000) * 900_000;
  bookParking(owner, { bookedFor: 'guest', guest: { name: 'Sample Guest' }, vehiclePlate: 'DEMO 202', parkingType: 'standard', spaceId: 'sp-V-011', start, end: start + 2 * 3600_000 });
});
if (!flag('no-series')) {
  step('Quarter-hour readings for the building and both apartments, 2026 to 2029', () => {
    const from = slotOf(Date.parse('2026-01-01T00:00:00+02:00'));
    const to = slotOf(Date.parse('2029-12-31T23:45:00+02:00'));
    const units = [homeA, homeB].map((id) => unitSeriesKey(id));
    for (let start = from; start <= to; start += 2000) {
      const end = Math.min(to, start + 1999);
      const slots = Array.from({ length: end - start + 1 }, (_, index) => start + index);
      transaction(() => {
        upsertBmsRows(slots.map((slot) => ({ site_key: site.seriesKey, slot, source: 0, ...bmsReading(42, site.seriesKey, slot) })));
        upsertEnergyRows(units.flatMap((key) => slots.map((slot) => ({ unit_key: key, slot, source: 0, ...unitEnergy(42, key, slot) }))));
      });
    }
  });
}

console.log(`\nDemo accounts (password "${password}"): demo.owner@example.com, demo.member@example.com, demo.neighbour@example.com, demo.gate@example.com (gate staff).`);
