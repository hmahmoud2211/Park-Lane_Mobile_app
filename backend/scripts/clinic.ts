import { randomBytes, randomUUID } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';
import { parseArgs } from 'node:util';

import { createUser, findUserByEmail, normalizeEmail, setPassword, type Role } from '../src/ems/auth.ts';
import { transaction } from '../src/ems/db.ts';
import { addProfile, insertItem, cleanItem, setConsent, listProfiles } from '../src/health/passport.ts';
import { doctorForUser, photoDir } from '../src/clinic/doctors.ts';
import { clinicInstant, HH_MM, minutesOf } from '../src/clinic/time.ts';
import {
  deleteDoctorSchedule,
  insertDemoDoctor,
  insertDoctor,
  insertScheduleBlock,
  insertTimeOff,
  listDoctorAccounts,
  listScheduleRows,
  setDoctorActive,
  setDoctorPhoto,
  updateDoctorColumns,
  type DoctorColumn,
} from '../src/repositories/clinicDoctors.ts';
import { insertSpecialtyIfMissing, listAllSpecialties, specialtyExists, upsertSpecialty } from '../src/repositories/clinicSpecialties.ts';
import { setProfileSexAndBirthDate } from '../src/repositories/healthProfiles.ts';
import { listDeskAccounts } from '../src/repositories/users.ts';

/**
 * Clinic administration, run on the server:  npm run clinic -- <command>
 *
 *   specialty add <id> --en <name> --ar <name>
 *   doctor add --email <e> --name <n> --specialty <id> [--minutes 20] [--name-ar] [--title] [--title-ar]
 *              [--bio] [--bio-ar] [--years] [--fee] [--languages en,ar] [--photo <file>] [--password <p>]
 *   doctor update <email> [any of the fields above]      doctor deactivate|activate <email>
 *   doctor schedule <email> --set "sun 09:00-13:00, sun 17:00-21:00, mon 09:00-13:00"
 *   doctor time-off <email> --from 2026-11-03T09:00 --to 2026-11-03T13:00 [--reason <text>]
 *   staff add --email <e> --name <n> [--password <p>]
 *   password reset <email> [--password <p>]
 *   list
 *   demo-seed          development only: sample doctors, a sample resident and their Health Passport
 *
 * Doctor and desk accounts can only be made here; the public register route
 * always makes residents. Without --password a strong one is generated and
 * printed once.
 */

const WEEKDAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    email: { type: 'string' },
    name: { type: 'string' },
    'name-ar': { type: 'string' },
    specialty: { type: 'string' },
    minutes: { type: 'string' },
    title: { type: 'string' },
    'title-ar': { type: 'string' },
    bio: { type: 'string' },
    'bio-ar': { type: 'string' },
    years: { type: 'string' },
    fee: { type: 'string' },
    languages: { type: 'string' },
    photo: { type: 'string' },
    password: { type: 'string' },
    en: { type: 'string' },
    ar: { type: 'string' },
    set: { type: 'string' },
    from: { type: 'string' },
    to: { type: 'string' },
    reason: { type: 'string' },
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const generatedPassword = () => randomBytes(12).toString('base64url');

function intOption(name: string, value: string | undefined): number | null {
  if (value === undefined) return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) fail(`--${name} must be a whole number.`);
  return parsed;
}

function storePhoto(doctorId: string, file: string): string {
  if (!existsSync(file)) fail(`No such photo: ${file}`);
  const extension = extname(file).toLowerCase();
  if (!['.jpg', '.jpeg', '.png', '.webp'].includes(extension)) fail('The photo must be a .jpg, .png or .webp file.');
  mkdirSync(photoDir(), { recursive: true, mode: 0o700 });
  const name = `${doctorId}${extension}`;
  copyFileSync(file, join(photoDir(), name));
  return name;
}

async function staffAccount(role: Role): Promise<{ id: string; password: string }> {
  if (!values.email || !values.name) fail('--email and --name are required.');
  const password = values.password ?? generatedPassword();
  if (password.length < 10) fail('Clinic passwords must be at least 10 characters.');
  const existing = findUserByEmail(normalizeEmail(values.email));
  if (existing) fail(`An account with ${values.email} already exists.`);
  const user = await createUser(values.email, password, values.name, role);
  return { id: user.id, password };
}

function doctorFields() {
  return {
    display_name_ar: values['name-ar'] ?? null,
    title: values.title ?? null,
    title_ar: values['title-ar'] ?? null,
    bio: values.bio ?? null,
    bio_ar: values['bio-ar'] ?? null,
    years_experience: intOption('years', values.years),
    fee_egp: intOption('fee', values.fee),
    languages: values.languages ? JSON.stringify(values.languages.split(',').map((code) => code.trim()).filter(Boolean)) : null,
  };
}

function requireSpecialty(id: string) {
  if (!specialtyExists(id)) {
    fail(`No specialty "${id}". Add it first: npm run clinic -- specialty add ${id} --en <name> --ar <name>`);
  }
}

function doctorByEmail(email: string | undefined) {
  if (!email) fail('Give the doctor’s email.');
  const user = findUserByEmail(normalizeEmail(email));
  const doctor = user ? doctorForUser(user.id) : null;
  if (!doctor) fail(`No doctor with the email ${email}.`);
  return doctor;
}

/** "sun 09:00-13:00, mon 17:00-21:00" */
function parseSchedule(text: string): { weekday: number; start: string; end: string }[] {
  return text.split(',').map((part) => {
    const match = /^\s*([a-z]{3})\s+(\d{2}:\d{2})-(\d{2}:\d{2})\s*$/i.exec(part);
    const weekday = match ? WEEKDAYS.indexOf(match[1].toLowerCase()) : -1;
    if (!match || weekday < 0 || !HH_MM.test(match[2]) || !HH_MM.test(match[3]) || minutesOf(match[2]) >= minutesOf(match[3])) {
      fail(`Cannot read "${part.trim()}". Write blocks like "sun 09:00-13:00".`);
    }
    return { weekday, start: match[2], end: match[3] };
  });
}

function setSchedule(doctorId: string, blocks: { weekday: number; start: string; end: string }[]) {
  transaction(() => {
    deleteDoctorSchedule(doctorId);
    for (const block of blocks) {
      insertScheduleBlock(randomUUID(), doctorId, block);
    }
  });
}

/** The slot loop steps by this, so zero or less would never finish and would freeze the backend. */
function consultationMinutes(minutes: number): number {
  if (minutes < 5 || minutes > 240) fail('--minutes must be between 5 and 240.');
  return minutes;
}

async function addDoctor(): Promise<void> {
  if (!values.specialty) fail('--specialty is required.');
  requireSpecialty(values.specialty);
  const minutes = consultationMinutes(intOption('minutes', values.minutes) ?? 20);
  const account = await staffAccount('doctor');
  const id = randomUUID();
  const at = new Date().toISOString();
  const fields = doctorFields();
  insertDoctor({
    id,
    userId: account.id,
    specialtyId: values.specialty,
    displayName: values.name as string,
    displayNameAr: fields.display_name_ar,
    title: fields.title,
    titleAr: fields.title_ar,
    bio: fields.bio,
    bioAr: fields.bio_ar,
    yearsExperience: fields.years_experience,
    consultationMinutes: minutes,
    feeEgp: fields.fee_egp,
    languages: fields.languages,
    at,
  });
  if (values.photo) setDoctorPhoto(id, storePhoto(id, values.photo));
  console.log(`Doctor added: ${values.name} <${values.email}>`);
  if (!values.password) console.log(`Temporary password (shown once): ${account.password}`);
  console.log(`Next: npm run clinic -- doctor schedule ${values.email} --set "sun 09:00-13:00, mon 09:00-13:00"`);
}

function updateDoctor(email: string | undefined): void {
  const doctor = doctorByEmail(email);
  const changes: Partial<Record<DoctorColumn, string | number | null>> = {};
  const fields = doctorFields();
  for (const [column, value] of Object.entries(fields)) if (value !== null) changes[column as DoctorColumn] = value;
  if (values.name) changes.display_name = values.name;
  if (values.specialty) {
    requireSpecialty(values.specialty);
    changes.specialty_id = values.specialty;
  }
  const minutes = intOption('minutes', values.minutes);
  if (minutes !== null) changes.consultation_minutes = consultationMinutes(minutes);
  if (values.photo) changes.photo = storePhoto(doctor.id, values.photo);
  const columns = Object.keys(changes);
  if (columns.length === 0) fail('Nothing to change.');
  updateDoctorColumns(doctor.id, changes, new Date().toISOString());
  console.log(`Updated ${doctor.display_name}: ${columns.join(', ')}`);
}

function list(): void {
  const specialties = listAllSpecialties();
  console.log('Specialties:');
  for (const entry of specialties) console.log(`  ${entry.id}  ${entry.name_en} / ${entry.name_ar}`);
  const doctors = listDoctorAccounts();
  console.log('Doctors:');
  for (const doctor of doctors) {
    const blocks = listScheduleRows(doctor.id);
    const hours = blocks.map((block) => `${WEEKDAYS[block.weekday]} ${block.start_time}-${block.end_time}`).join(', ') || 'no hours set';
    console.log(`  ${doctor.display_name} <${doctor.email}>  ${doctor.specialty_id}, ${doctor.consultation_minutes} min${doctor.active ? '' : ' (inactive)'}  ${hours}`);
  }
  const staff = listDeskAccounts();
  console.log('Front desk:');
  for (const entry of staff) console.log(`  ${entry.name} <${entry.email}>`);
}

/**
 * Sample data for running the clinic locally: specialties, three doctors
 * working every day, and a resident with a filled-in Health Passport. Every
 * name says it is a demo. Refused in production.
 */
async function demoSeed(): Promise<void> {
  if (process.env.NODE_ENV === 'production') fail('demo-seed is for development only.');
  const specialties = [
    ['general-medicine', 'General Medicine', 'الطب العام'],
    ['cardiology', 'Cardiology', 'أمراض القلب'],
    ['pediatrics', 'Pediatrics', 'طب الأطفال'],
    ['dermatology', 'Dermatology', 'الأمراض الجلدية'],
  ];
  for (const [id, en, ar] of specialties) {
    insertSpecialtyIfMissing(id, en, ar, new Date().toISOString());
  }
  const allWeek = WEEKDAYS.map((_, weekday) => [
    { weekday, start: '09:00', end: '13:00' },
    { weekday, start: '16:00', end: '22:00' },
  ]).flat();
  const doctors = [
    { email: 'demo.cardiology@parklane.test', name: 'Dr. Demo Karim Hassan', nameAr: 'د. كريم حسن (تجريبي)', specialty: 'cardiology', title: 'Consultant Cardiologist', years: 15, fee: 900, minutes: 20, bio: 'Demo doctor for local testing. Heart rhythm, blood pressure and cholesterol.' },
    { email: 'demo.gp@parklane.test', name: 'Dr. Demo Nour Adel', nameAr: 'د. نور عادل (تجريبي)', specialty: 'general-medicine', title: 'General Practitioner', years: 8, fee: 500, minutes: 15, bio: 'Demo doctor for local testing. Everyday illnesses, check-ups and referrals.' },
    { email: 'demo.pediatrics@parklane.test', name: 'Dr. Demo Salma Fathy', nameAr: 'د. سلمى فتحي (تجريبي)', specialty: 'pediatrics', title: 'Pediatrics Specialist', years: 11, fee: 700, minutes: 20, bio: 'Demo doctor for local testing. Children from birth to sixteen.' },
  ];
  const credentials: string[] = [];
  for (const entry of doctors) {
    if (findUserByEmail(entry.email)) continue;
    const password = 'DemoDoctor#2026';
    const user = await createUser(entry.email, password, entry.name, 'doctor');
    const id = randomUUID();
    const at = new Date().toISOString();
    insertDemoDoctor({
      id,
      userId: user.id,
      specialtyId: entry.specialty,
      displayName: entry.name,
      displayNameAr: entry.nameAr,
      title: entry.title,
      bio: entry.bio,
      yearsExperience: entry.years,
      consultationMinutes: entry.minutes,
      feeEgp: entry.fee,
      languages: '["en","ar"]',
      at,
    });
    setSchedule(id, allWeek);
    credentials.push(`  doctor  ${entry.email}  ${password}`);
  }
  if (!findUserByEmail('demo.desk@parklane.test')) {
    await createUser('demo.desk@parklane.test', 'DemoDesk#2026', 'Demo Front Desk', 'clinic_staff');
    credentials.push('  desk    demo.desk@parklane.test  DemoDesk#2026');
  }
  if (!findUserByEmail('demo.resident@parklane.test')) {
    const resident = await createUser('demo.resident@parklane.test', 'DemoResident#2026', 'Demo Ahmed Mohamed');
    transaction(() => {
      setConsent(resident.id, true);
      const self = listProfiles(resident.id)[0];
      setProfileSexAndBirthDate(self.id, 'male', '1968-03-14');
      const add = (section: Parameters<typeof cleanItem>[0], data: Record<string, unknown>) =>
        insertItem(self.id, section, cleanItem(section, data), null);
      add('allergies', { substance: 'Penicillin', reaction: 'rash and swelling', severity: 'severe' });
      add('medications', { name: 'Metformin', dose: '500 mg', frequency: 'twice daily', start: '2019-06-01' });
      add('conditions', { name: 'Type 2 diabetes', diagnosed: '2019-05-20', status: 'active' });
      add('labs', { test: 'HbA1c', value: 7.6, unit: '%', date: '2026-08-19', ref_high: 5.7 });
      add('labs', { test: 'LDL cholesterol', value: 3.6, unit: 'mmol/L', date: '2024-03-01', ref_high: 3.0 });
      add('procedures', { name: 'Gallbladder removal', date: '2022-11-03' });
      addProfile(resident.id, { name: 'Demo Laila', relation: 'child', sex: 'female', date_of_birth: '2016-05-02', blood_type: 'O+' });
    });
    credentials.push('  resident demo.resident@parklane.test  DemoResident#2026');
  }
  console.log('Demo clinic ready (development only). Sign-ins created this run:');
  console.log(credentials.length ? credentials.join('\n') : '  (none: the demo accounts already existed)');
}

const [group, command, subject] = positionals;

switch (`${group ?? ''} ${command ?? ''}`.trim()) {
  case 'specialty add': {
    if (!command || !subject || !values.en || !values.ar) fail('Usage: specialty add <id> --en <name> --ar <name>');
    if (!/^[a-z][a-z0-9-]{1,40}$/.test(subject)) fail('A specialty id is lowercase letters, digits and dashes, e.g. general-medicine.');
    upsertSpecialty(subject, values.en, values.ar, new Date().toISOString());
    console.log(`Specialty saved: ${subject}`);
    break;
  }
  case 'doctor add':
    await addDoctor();
    break;
  case 'doctor update':
    updateDoctor(subject);
    break;
  case 'doctor deactivate':
  case 'doctor activate': {
    const doctor = doctorByEmail(subject);
    setDoctorActive(doctor.id, command === 'activate' ? 1 : 0, new Date().toISOString());
    console.log(`${doctor.display_name} is now ${command === 'activate' ? 'active' : 'inactive'}. Existing appointments are kept.`);
    break;
  }
  case 'doctor schedule': {
    const doctor = doctorByEmail(subject);
    if (!values.set) fail('Give the weekly hours with --set "sun 09:00-13:00, mon 09:00-13:00".');
    setSchedule(doctor.id, parseSchedule(values.set));
    console.log(`Weekly hours saved for ${doctor.display_name}. Booked appointments are not moved.`);
    break;
  }
  case 'doctor time-off': {
    const doctor = doctorByEmail(subject);
    const parse = (value: string | undefined) => {
      const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(value ?? '');
      if (!match) fail('Write --from and --to as clinic time, e.g. 2026-11-03T09:00.');
      return new Date(clinicInstant(match[1], match[2])).toISOString();
    };
    const [from, to] = [parse(values.from), parse(values.to)];
    if (from >= to) fail('--to must be after --from.');
    insertTimeOff(randomUUID(), doctor.id, from, to, values.reason ?? null);
    console.log(`Time off saved for ${doctor.display_name}. Appointments already booked in it are not cancelled; check them with the desk.`);
    break;
  }
  case 'staff add': {
    const account = await staffAccount('clinic_staff');
    console.log(`Front desk account added: ${values.name} <${values.email}>`);
    if (!values.password) console.log(`Temporary password (shown once): ${account.password}`);
    break;
  }
  case 'password reset': {
    const user = subject ? findUserByEmail(normalizeEmail(subject)) : null;
    if (!user || user.role === 'resident') fail('No doctor or desk account with that email.');
    const password = values.password ?? generatedPassword();
    await setPassword(user.id, password);
    console.log(`Password reset for ${user.email}; their sessions were signed out.`);
    if (!values.password) console.log(`Temporary password (shown once): ${password}`);
    break;
  }
  case 'list':
    list();
    break;
  case 'demo-seed':
    await demoSeed();
    break;
  default:
    fail('Commands: specialty add | doctor add|update|activate|deactivate|schedule|time-off | staff add | password reset | list | demo-seed');
}
