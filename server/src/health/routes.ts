import type { IncomingMessage, ServerResponse } from 'node:http';

import { audit } from '../clinic/audit.ts';
import { ApiError } from '../errors.ts';
import { requireUser, type User } from '../ems/auth.ts';
import { transaction } from '../ems/db.ts';
import { readJson, send } from '../http.ts';
import { log } from '../log.ts';
import { patientConsultation, patientConsultations } from './consultations.ts';
import * as passport from './passport.ts';

/**
 * Health Passport's HTTP API, as the app's HttpHealthService calls it
 * (src/services/health/httpHealthService.ts): `/health/...` on this backend,
 * the app's own EMS session, bodies in the app's snake_case shapes, and
 * errors as `{ detail, error: { code, message } }` with the status codes
 * the app maps (401, 404, 413, 422, 503).
 *
 * Reading uploaded documents and spoken summaries for residents need an AI
 * document reader this backend does not have yet; those routes answer 503
 * with an explanation rather than pretending to work.
 */

const NOT_AVAILABLE = 'This isn’t available on the Park Lane server yet.';

const langOf = (req: IncomingMessage): passport.HealthLang =>
  String(req.headers['accept-language'] ?? '').toLowerCase().startsWith('ar') ? 'ar' : 'en';

function fail(res: ServerResponse, error: unknown, path: string) {
  const known = error instanceof ApiError ? error : new ApiError('internal', 'Something went wrong.');
  if (!(error instanceof ApiError)) log.error('Unhandled Health Passport error', { path, reason: (error as Error).message });
  send(res, known.status, { detail: known.field ?? known.message, error: { code: known.code, message: known.message } });
}

const segment = (value: string) => decodeURIComponent(value);

function reply(res: ServerResponse, body: unknown): true {
  send(res, 200, body);
  return true;
}

function noContent(res: ServerResponse): true {
  res.writeHead(204, { 'Cache-Control': 'no-store' }).end();
  return true;
}

async function handle(req: IncomingMessage, res: ServerResponse, url: URL, user: User): Promise<boolean> {
  const method = req.method ?? 'GET';
  const path = url.pathname;
  const lang = langOf(req);

  if (path === '/health/consent') {
    if (method === 'GET') return reply(res, passport.getConsent(user.id));
    if (method === 'POST') {
      const body = await readJson(req);
      if (typeof body.given !== 'boolean') throw new ApiError('invalid', 'given must be true or false.', 'given');
      return reply(res, transaction(() => passport.setConsent(user.id, body.given as boolean)));
    }
  }

  passport.requireConsent(user.id);

  if (path === '/health/profiles') {
    if (method === 'GET') return reply(res, passport.listProfiles(user.id));
    if (method === 'POST') return reply(res, passport.addProfile(user.id, await readJson(req)));
  }

  const profile = /^\/health\/profiles\/([^/]+)$/.exec(path);
  if (profile) {
    const id = segment(profile[1]);
    if (method === 'PUT') return reply(res, passport.updateProfile(user.id, id, await readJson(req)));
    if (method === 'DELETE') {
      transaction(() => passport.deleteProfile(user.id, id));
      return noContent(res);
    }
  }

  const record = /^\/health\/profiles\/([^/]+)\/record$/.exec(path);
  if (record && method === 'GET') {
    const id = segment(record[1]);
    passport.ownedProfile(user.id, id);
    return reply(res, { ...passport.readRecord(id, lang), consultations: patientConsultations(id) });
  }

  const items = /^\/health\/profiles\/([^/]+)\/([a-z]+)(?:\/([^/]+))?$/.exec(path);
  if (items && passport.isSection(items[2])) {
    const [profileId, section, itemId] = [segment(items[1]), items[2], items[3] ? segment(items[3]) : null];
    if (!itemId && method === 'POST') {
      const body = await readJson(req);
      return reply(res, transaction(() => passport.createItem(user.id, profileId, section, body)));
    }
    if (itemId && method === 'PUT') {
      const body = await readJson(req);
      return reply(res, transaction(() => passport.updateItem(user.id, profileId, section, itemId, body)));
    }
    if (itemId && method === 'DELETE') {
      transaction(() => passport.deleteItem(user.id, profileId, section, itemId));
      return noContent(res);
    }
  }

  // Documents: there is no document reader on this backend, so there are none, and uploads are refused.
  const documents = /^\/health\/profiles\/([^/]+)\/documents$/.exec(path);
  if (documents) {
    passport.ownedProfile(user.id, segment(documents[1]));
    if (method === 'GET') return reply(res, []);
    if (method === 'POST') throw new ApiError('not_configured', `Reading documents: ${NOT_AVAILABLE}`);
  }
  if (/^\/health\/documents\/[^/]+(\/confirm)?$/.test(path)) {
    throw new ApiError('not_found', 'Document not found.');
  }

  // Spoken summaries for residents: none exist; asking for one says why.
  const summary = /^\/health\/profiles\/([^/]+)\/summary$/.exec(path);
  if (summary) {
    passport.ownedProfile(user.id, segment(summary[1]));
    if (method === 'GET') throw new ApiError('not_found', 'No summary yet.');
    if (method === 'POST') throw new ApiError('not_configured', `Spoken summaries: ${NOT_AVAILABLE}`);
  }

  // A clinic visit the resident's doctor finalized, as the resident reads it.
  const consultation = /^\/health\/consultations\/([^/]+)$/.exec(path);
  if (consultation && method === 'GET') {
    const found = patientConsultation(user.id, segment(consultation[1]));
    audit({ actor: user, action: 'passport.consultation_viewed', consultationId: found.id, patientProfileId: found.profile_id });
    return reply(res, found);
  }

  return false;
}

/** `/health/...` requests; false for any other path. */
export async function healthRoute(req: IncomingMessage, res: ServerResponse, url: URL): Promise<boolean> {
  if (!url.pathname.startsWith('/health/')) return false;
  try {
    const user = requireUser(req);
    if (!(await handle(req, res, url, user))) throw new ApiError('not_found', 'Not found.');
  } catch (error) {
    if (!res.headersSent) fail(res, error, url.pathname);
  }
  return true;
}
