import type { IncomingMessage, ServerResponse } from 'node:http';

import { config } from '../config.ts';
import { ApiError } from '../errors.ts';
import { requireRole, requireUser, type User } from '../ems/auth.ts';
import { listProfiles, consentGiven, type HealthLang } from '../health/passport.ts';
import { readBytes, readJson } from '../http/body.ts';
import { throttle } from '../http/rateLimits.ts';
import { ok, sendBytes } from '../http/respond.ts';
import type { RouteGroup } from '../http/router.ts';
import { aiConfigured } from '../integrations/ai/model.ts';
import * as appointments from '../clinic/appointments.ts';
import { audit } from '../clinic/audit.ts';
import * as consultations from '../clinic/consultations.ts';
import * as doctors from '../clinic/doctors.ts';
import { accessFor, patientHistory } from '../clinic/history.ts';
import { speechConfigured, type SpeechLang } from '../integrations/elevenlabs.ts';
import * as summaries from '../clinic/summaries.ts';

/**
 * The clinic's API, all under /api/clinic, answering `{ ok, data }` like the
 * rest of /api. Three audiences, each checked on the server:
 *
 *   residents (the app)    directory, slots, booking, their own appointments
 *     GET  /config  /specialties  /doctors  /doctors/:id  /doctors/:id/photo
 *     GET  /doctors/:id/availability?days=  /doctors/:id/slots?date=  /patients
 *     POST /appointments                       GET /me/appointments  /me/appointments/:id
 *     POST /me/appointments/:id/cancel         PATCH /me/appointments/:id/consents
 *
 *   doctors                their own appointments and patients only
 *     GET  /doctor/me  /doctor/dashboard?date=  /doctor/appointments  /doctor/appointments/:id
 *     POST /doctor/appointments/:id/status { action }   /doctor/appointments/:id/ai-consent
 *     GET  /doctor/appointments/:id/history            GET|POST /doctor/appointments/:id/history-summary
 *     POST /doctor/appointments/:id/history-summary/speech { lang }  → { version, parts }
 *     GET  /doctor/appointments/:id/history-summary/speech/:part?lang=&v=  → audio/mpeg
 *     POST /doctor/appointments/:id/consultation
 *     GET  /doctor/consultations  /doctor/consultations/:id   PUT /doctor/consultations/:id/draft
 *     POST /doctor/consultations/:id/dictation?lang=&note_lang= (audio body) | /finalize | /addenda
 *     GET  /doctor/patients?q=  /doctor/patients/:profileId
 *
 *   the front desk         check-in and the day's list, no clinical content
 *     GET  /desk/day?date=     POST /desk/appointments/:id/status { action }
 */

const PREFIX = '/api/clinic';

const langOf = (value: unknown): HealthLang => (value === 'ar' ? 'ar' : 'en');

function doctorOf(user: User): doctors.DoctorRow {
  const doctor = doctors.doctorForUser(user.id);
  if (!doctor || doctor.active !== 1) throw new ApiError('forbidden', 'This account is not an active clinic doctor.');
  return doctor;
}

function action(value: unknown): appointments.Action {
  if (typeof value !== 'string' || !(value in appointments.TRANSITIONS)) {
    throw new ApiError('bad_request', `action must be one of ${Object.keys(appointments.TRANSITIONS).join(', ')}.`);
  }
  return value as appointments.Action;
}

async function residentRoute(req: IncomingMessage, res: ServerResponse, path: string, url: URL): Promise<boolean> {
  const method = req.method ?? 'GET';

  // Doctors' photos are part of the public directory and load in <img>, which cannot send a token.
  const photo = /^\/doctors\/([^/]+)\/photo$/.exec(path);
  if (photo && method === 'GET') {
    const found = doctors.doctorPhoto(decodeURIComponent(photo[1]));
    sendBytes(res, found.type, found.body);
    return true;
  }

  const user = requireUser(req);

  if (path === '/config' && method === 'GET') {
    ok(res, {
      timezone: config.clinic.timezone,
      booking_horizon_days: config.clinic.bookingHorizonDays,
      any_time_booking: config.clinic.anyTimeBooking,
      ai_available: aiConfigured(),
      speech_available: speechConfigured(),
      role: user.role,
    });
    return true;
  }
  if (path === '/specialties' && method === 'GET') {
    ok(res, doctors.listSpecialties());
    return true;
  }
  if (path === '/doctors' && method === 'GET') {
    ok(res, doctors.listDoctors({ specialty: url.searchParams.get('specialty'), q: url.searchParams.get('q') }));
    return true;
  }
  const doctor = /^\/doctors\/([^/]+)(?:\/(availability|slots))?$/.exec(path);
  if (doctor && method === 'GET') {
    const row = doctors.activeDoctor(decodeURIComponent(doctor[1]));
    if (!doctor[2]) {
      ok(res, doctors.presentDoctor(row));
    } else if (doctor[2] === 'availability') {
      ok(res, { timezone: config.clinic.timezone, days: doctors.availability(row, Number(url.searchParams.get('days') || 14)) });
    } else {
      const date = url.searchParams.get('date') ?? '';
      ok(res, { date, timezone: config.clinic.timezone, slots: doctors.slotsFor(row, date) });
    }
    return true;
  }

  // Who the resident can book for: the Health Passport profiles they keep, and those shared with them to edit.
  if (path === '/patients' && method === 'GET') {
    const consent = consentGiven(user.id);
    ok(res, { health_passport: consent, profiles: consent ? listProfiles(user.id).filter((profile) => profile.access !== 'view') : [] });
    return true;
  }

  if (path === '/appointments' && method === 'POST') {
    throttle('clinic-book', user.id);
    ok(res, appointments.book(user, await readJson(req)));
    return true;
  }
  if (path === '/me/appointments' && method === 'GET') {
    ok(res, appointments.residentAppointments(user));
    return true;
  }
  const mine = /^\/me\/appointments\/([^/]+)(?:\/(cancel|consents))?$/.exec(path);
  if (mine) {
    const id = decodeURIComponent(mine[1]);
    if (!mine[2] && method === 'GET') {
      ok(res, appointments.residentView(appointments.appointmentFor({ user }, id)));
      return true;
    }
    if (mine[2] === 'cancel' && method === 'POST') {
      const body = await readJson(req);
      ok(res, appointments.residentView(appointments.transition({ user }, id, 'cancel', { reason: body.reason })));
      return true;
    }
    if (mine[2] === 'consents' && method === 'PATCH') {
      ok(res, appointments.updateResidentConsents(user, id, await readJson(req)));
      return true;
    }
  }
  return false;
}

async function doctorRoute(req: IncomingMessage, res: ServerResponse, path: string, url: URL): Promise<boolean> {
  const method = req.method ?? 'GET';
  const user = requireRole(req, ['doctor']);
  const doctor = doctorOf(user);
  const actor = { user, doctorId: doctor.id };

  if (path === '/me' && method === 'GET') {
    ok(res, { user, doctor: doctors.presentDoctor(doctor) });
    return true;
  }
  if (path === '/dashboard' && method === 'GET') {
    ok(res, appointments.dashboard(doctor.id, url.searchParams.get('date')));
    return true;
  }
  if (path === '/appointments' && method === 'GET') {
    const params = url.searchParams;
    ok(res, appointments.doctorAppointments(doctor.id, { from: params.get('from'), to: params.get('to'), status: params.get('status'), q: params.get('q') }));
    return true;
  }

  const appointment = /^\/appointments\/([^/]+)(?:\/([a-z-]+(?:\/speech(?:\/\d+)?)?))?$/.exec(path);
  if (appointment) {
    const id = decodeURIComponent(appointment[1]);
    const sub = appointment[2] ?? '';
    if (!sub && method === 'GET') {
      const row = appointments.appointmentFor(actor, id);
      ok(res, { appointment: appointments.staffView(row), history_access: accessFor(row) });
      return true;
    }
    if (sub === 'status' && method === 'POST') {
      const body = await readJson(req);
      ok(res, appointments.staffView(appointments.transition(actor, id, action(body.action), { reason: body.reason })));
      return true;
    }
    if (sub === 'ai-consent' && method === 'POST') {
      ok(res, appointments.staffView(appointments.recordInPersonAiConsent(actor, id)));
      return true;
    }
    if (sub === 'history' && method === 'GET') {
      const row = appointments.appointmentFor(actor, id);
      const history = patientHistory(doctor, row);
      audit({ actor: user, action: 'history.viewed', appointmentId: id, patientProfileId: row.patient_profile_id, detail: { access: history.access.level } });
      ok(res, history);
      return true;
    }
    if (sub === 'history-summary' && method === 'GET') {
      ok(res, summaries.latestSummary(user, doctor, id, langOf(url.searchParams.get('lang'))));
      return true;
    }
    if (sub === 'history-summary' && method === 'POST') {
      throttle('clinic-ai', user.id);
      const body = await readJson(req);
      ok(res, await summaries.generateSummary(user, doctor, id, langOf(body.lang)));
      return true;
    }
    if (sub === 'history-summary/speech' && method === 'POST') {
      throttle('clinic-tts', user.id);
      const body = await readJson(req);
      ok(res, await summaries.prepareSpokenSummary(user, doctor, id, langOf(body.lang)));
      return true;
    }
    const part = /^history-summary\/speech\/(\d+)$/.exec(sub);
    if (part && method === 'GET') {
      throttle('clinic-tts-part', user.id);
      const params = url.searchParams;
      sendBytes(res, 'audio/mpeg', await summaries.speakSummaryPart(user, doctor, id, langOf(params.get('lang')), Number(part[1]), params.get('v') ?? ''));
      return true;
    }
    if (sub === 'consultation' && method === 'POST') {
      ok(res, consultations.openConsultation(user, doctor, id));
      return true;
    }
  }

  if (path === '/consultations' && method === 'GET') {
    ok(res, consultations.doctorHistory(doctor, { q: url.searchParams.get('q') }));
    return true;
  }
  const consultation = /^\/consultations\/([^/]+)(?:\/([a-z-]+))?$/.exec(path);
  if (consultation) {
    const id = decodeURIComponent(consultation[1]);
    const sub = consultation[2] ?? '';
    if (!sub && method === 'GET') {
      ok(res, consultations.getConsultation(user, doctor, id));
      return true;
    }
    if (sub === 'draft' && method === 'PUT') {
      ok(res, consultations.saveDraft(user, doctor, id, await readJson(req, config.clinic.maxNoteBytes)));
      return true;
    }
    if (sub === 'dictation' && method === 'POST') {
      // One clip is a transcription and an AI request.
      throttle('clinic-stt', user.id);
      throttle('clinic-ai', user.id);
      const params = url.searchParams;
      const lang = params.get('lang');
      const audio = await readBytes(req, config.clinic.maxSegmentBytes);
      ok(
        res,
        await consultations.dictate(user, doctor, id, audio, {
          mimeType: String(req.headers['content-type'] ?? ''),
          lang: (lang === 'ar' || lang === 'en' ? lang : 'auto') as SpeechLang,
          noteLang: langOf(params.get('note_lang')),
        }),
      );
      return true;
    }
    if (sub === 'finalize' && method === 'POST') {
      ok(res, consultations.finalize(user, doctor, id, await readJson(req, config.clinic.maxNoteBytes)));
      return true;
    }
    if (sub === 'addenda' && method === 'POST') {
      ok(res, consultations.addAddendum(user, doctor, id, await readJson(req)));
      return true;
    }
  }

  if (path === '/patients' && method === 'GET') {
    ok(res, appointments.doctorPatients(doctor.id, url.searchParams.get('q')));
    return true;
  }
  const patient = /^\/patients\/([^/]+)$/.exec(path);
  if (patient && method === 'GET') {
    const profileId = decodeURIComponent(patient[1]);
    const theirs = appointments
      .doctorAppointments(doctor.id, {})
      .filter((entry) => entry.patient.profile_id === profileId);
    if (theirs.length === 0) throw new ApiError('not_found', 'Patient not found.');
    // History is opened through the visit that authorizes it: the current or next one, else the latest.
    const live = theirs.filter((entry) => ['scheduled', 'checked_in', 'waiting', 'in_consultation'].includes(entry.status));
    const context = live.at(-1) ?? theirs[0];
    const row = appointments.appointmentFor(actor, context.id);
    const history = patientHistory(doctor, row);
    audit({ actor: user, action: 'history.viewed', appointmentId: row.id, patientProfileId: profileId, detail: { access: history.access.level } });
    ok(res, { appointments: theirs, context_appointment_id: row.id, history });
    return true;
  }
  return false;
}

async function deskRoute(req: IncomingMessage, res: ServerResponse, path: string, url: URL): Promise<boolean> {
  const method = req.method ?? 'GET';
  const user = requireRole(req, ['clinic_staff']);
  if (path === '/day' && method === 'GET') {
    ok(res, appointments.deskDay(url.searchParams.get('date')));
    return true;
  }
  const status = /^\/appointments\/([^/]+)\/status$/.exec(path);
  if (status && method === 'POST') {
    const body = await readJson(req);
    ok(res, appointments.staffView(appointments.transition({ user }, decodeURIComponent(status[1]), action(body.action), { reason: body.reason })));
    return true;
  }
  return false;
}

export const clinicRoutes: RouteGroup = async ({ req, res, path, url }) => {
  if (!path.startsWith(`${PREFIX}/`)) return false;
  const rest = path.slice(PREFIX.length);
  if (rest.startsWith('/doctor/')) return doctorRoute(req, res, rest.slice('/doctor'.length), url);
  if (rest.startsWith('/desk/')) return deskRoute(req, res, rest.slice('/desk'.length), url);
  return residentRoute(req, res, rest, url);
};
