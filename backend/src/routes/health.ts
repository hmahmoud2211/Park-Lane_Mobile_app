import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable, Transform } from 'node:stream';

import { aiConfigured } from '../integrations/ai/model.ts';
import { audit } from '../clinic/audit.ts';
import { speechConfigured } from '../integrations/elevenlabs.ts';
import { ApiError } from '../errors.ts';
import { bearerOf, lookupToken, requireUser, type User } from '../ems/auth.ts';
import { transaction } from '../ems/db.ts';
import { readJson } from '../http/body.ts';
import { throttle } from '../http/rateLimits.ts';
import { send, sendBytes } from '../http/respond.ts';
import type { RouteGroup } from '../http/router.ts';
import { log } from '../log.ts';
import { patientConsultation, patientConsultations } from '../health/consultations.ts';
import * as documents from '../health/documents.ts';
import { linkValid, publicBase, sweepOrphanFiles } from '../health/files.ts';
import * as passport from '../health/passport.ts';
import * as sharing from '../health/sharing.ts';
import * as summaries from '../health/summaries.ts';

/**
 * Health Passport's HTTP API, as the app's HttpHealthService calls it
 * (frontend/src/features/health/services/httpHealthService.ts): `/health/...` on this backend,
 * the app's own EMS session, bodies in the app's snake_case shapes, and
 * errors as `{ detail, error: { code, message } }` with the status codes
 * the app maps (401, 404, 413, 422, 503).
 *
 * Reading documents and spoken summaries run in the background with the AI
 * service (documents.ts, summaries.ts); without its key (or ElevenLabs' for
 * summaries) they answer 503 with an explanation rather than pretending to
 * work. Files are fetched from /health/media/..., by session or signed link.
 */

/** A whole document: up to 10 pages of 10 MB, plus the form's own fields. */
const MAX_UPLOAD_BYTES = documents.UPLOAD_LIMITS.maxPages * documents.UPLOAD_LIMITS.maxFileBytes + 1024 * 1024;

const EXTENSION_TYPES: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', pdf: 'application/pdf' };

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

/** A multipart upload, parsed by Node's own FormData, refused as soon as it passes the size limit. */
async function readUpload(req: IncomingMessage): Promise<FormData> {
  const contentType = String(req.headers['content-type'] ?? '');
  if (!contentType.startsWith('multipart/form-data')) throw new ApiError('invalid', 'Upload the pages as multipart/form-data.', 'files');
  if (Number(req.headers['content-length'] ?? 0) > MAX_UPLOAD_BYTES) throw new ApiError('too_large', 'The document is larger than 100 MB.');
  let size = 0;
  const counted = req.pipe(
    new Transform({
      transform(chunk: Buffer, _encoding, done) {
        size += chunk.length;
        done(size > MAX_UPLOAD_BYTES ? new ApiError('too_large', 'The document is larger than 100 MB.') : null, chunk);
      },
    }),
  );
  try {
    return await new Response(Readable.toWeb(counted) as ReadableStream, { headers: { 'content-type': contentType } }).formData();
  } catch {
    throw size > MAX_UPLOAD_BYTES ? new ApiError('too_large', 'The document is larger than 100 MB.') : new ApiError('invalid', 'The upload could not be read.', 'files');
  }
}

async function uploadedPages(form: FormData): Promise<documents.UploadedPage[]> {
  const files = form.getAll('files[]').filter((entry): entry is File => typeof entry !== 'string');
  return Promise.all(
    files.map(async (file) => ({
      name: file.name,
      mimeType: file.type || EXTENSION_TYPES[file.name.split('.').pop()?.toLowerCase() ?? ''] || 'application/octet-stream',
      bytes: Buffer.from(await file.arrayBuffer()),
    })),
  );
}

/**
 * GET /health/media/document/:id/:page and /health/media/summary/:id: a
 * document's page or a summary's recording, for a signed link the app was
 * given, or for the session of anyone who may see the profile.
 */
function mediaRoute(req: IncomingMessage, res: ServerResponse, url: URL): boolean {
  const page = /^\/health\/media\/document\/([^/]+)\/(\d+)$/.exec(url.pathname);
  const recording = /^\/health\/media\/summary\/([^/]+)$/.exec(url.pathname);
  if ((!page && !recording) || req.method !== 'GET') return false;
  const profileId = page ? documents.documentProfileId(segment(page[1])) : summaries.summaryProfileId(segment((recording as RegExpExecArray)[1]));
  const profile = profileId ? passport.profileById(profileId) : null;
  const session = lookupToken(bearerOf(req), ['session']);
  const allowed =
    linkValid(url.pathname, url) ||
    (session !== null && profile !== null && passport.consentGiven(session.user.id) && passport.accessTo(session.user.id, profile) !== null);
  if (!profile || !allowed) throw new ApiError('not_found', 'Not found.');
  if (page) {
    const found = documents.documentPage(segment(page[1]), Number(page[2]));
    if (!found) throw new ApiError('not_found', 'Not found.');
    sendBytes(res, found.mime, found.bytes);
  } else {
    const audio = summaries.summaryAudio(segment((recording as RegExpExecArray)[1]));
    if (!audio) throw new ApiError('not_found', 'Not found.');
    sendBytes(res, 'audio/mpeg', audio);
  }
  return true;
}

async function handle(req: IncomingMessage, res: ServerResponse, url: URL, user: User): Promise<boolean> {
  const method = req.method ?? 'GET';
  const path = url.pathname;
  const lang = langOf(req);
  const base = publicBase(req);

  if (path === '/health/consent') {
    if (method === 'GET') return reply(res, passport.getConsent(user.id));
    if (method === 'POST') {
      const body = await readJson(req);
      if (typeof body.given !== 'boolean') throw new ApiError('invalid', 'given must be true or false.', 'given');
      const consent = transaction(() => passport.setConsent(user.id, body.given as boolean));
      // Withdrawing deletes the health data; the pages and recordings it held go with it.
      if (!consent.given) sweepOrphanFiles();
      return reply(res, consent);
    }
  }

  passport.requireConsent(user.id);

  if (path === '/health/profiles') {
    if (method === 'GET') return reply(res, passport.listProfiles(user.id));
    if (method === 'POST') return reply(res, passport.addProfile(user.id, await readJson(req)));
  }

  // Sharing a profile with another resident of the apartment (health/sharing.ts).
  const shares = /^\/health\/profiles\/([^/]+)\/sharing(?:\/([^/]+))?$/.exec(path);
  if (shares) {
    // `me`: the signed-in resident, who stops seeing a profile shared with them.
    const [profileId, targetId] = [segment(shares[1]), shares[2] ? (segment(shares[2]) === 'me' ? user.id : segment(shares[2])) : null];
    if (!targetId && method === 'GET') return reply(res, sharing.sharingOf(user.id, profileId));
    if (targetId && method === 'PUT') {
      const body = await readJson(req);
      return reply(res, transaction(() => sharing.shareProfile(user, profileId, targetId, body)));
    }
    if (targetId && method === 'DELETE') {
      transaction(() => sharing.endShare(user, profileId, targetId));
      return noContent(res);
    }
  }

  const profile = /^\/health\/profiles\/([^/]+)$/.exec(path);
  if (profile) {
    const id = segment(profile[1]);
    if (method === 'PUT') return reply(res, passport.updateProfile(user.id, id, await readJson(req)));
    if (method === 'DELETE') {
      transaction(() => passport.deleteProfile(user.id, id));
      sweepOrphanFiles();
      return noContent(res);
    }
  }

  const record = /^\/health\/profiles\/([^/]+)\/record$/.exec(path);
  if (record && method === 'GET') {
    const id = segment(record[1]);
    passport.profileFor(user.id, id, 'view');
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

  const profileDocuments = /^\/health\/profiles\/([^/]+)\/documents$/.exec(path);
  if (profileDocuments) {
    const profileId = segment(profileDocuments[1]);
    if (method === 'GET') return reply(res, documents.listDocuments(user.id, profileId, lang, base));
    if (method === 'POST') {
      passport.profileFor(user.id, profileId, 'edit');
      if (!aiConfigured()) throw new ApiError('not_configured', 'Reading documents is not set up on this server yet.');
      throttle('health-upload', user.id);
      const form = await readUpload(req);
      const created = documents.createDocument(user.id, profileId, {
        type: form.get('type'),
        document_date: form.get('document_date'),
        pages: await uploadedPages(form),
      });
      return reply(res, created);
    }
  }
  const document = /^\/health\/documents\/([^/]+)(\/confirm)?$/.exec(path);
  if (document) {
    const docId = segment(document[1]);
    if (!document[2] && method === 'GET') return reply(res, documents.presentDocument(documents.documentFor(user.id, docId, 'view'), lang, base));
    if (document[2] && method === 'POST') {
      return reply(res, documents.presentDocument(documents.confirmDocument(user.id, docId, await readJson(req, 256 * 1024)), lang, base));
    }
    if (!document[2] && method === 'DELETE') {
      documents.deleteDocument(user.id, docId, url.searchParams.get('delete_items') === 'true');
      return noContent(res);
    }
  }

  const summary = /^\/health\/profiles\/([^/]+)\/summary$/.exec(path);
  if (summary) {
    const profileId = segment(summary[1]);
    if (method === 'GET') {
      const requested = url.searchParams.get('lang') === 'ar' ? 'ar' : 'en';
      const state = summaries.getSummary(user.id, profileId, requested, url.searchParams.get('specialty'), lang, base);
      if (!state) throw new ApiError('not_found', 'No summary yet.');
      send(res, state.status === 'generating' ? 202 : 200, state);
      return true;
    }
    if (method === 'POST') {
      passport.profileFor(user.id, profileId, 'view');
      if (!aiConfigured() || !speechConfigured()) throw new ApiError('not_configured', 'Spoken summaries are not set up on this server yet.');
      throttle('health-summary', user.id);
      const result = summaries.requestSummary(user.id, profileId, await readJson(req), lang, base);
      send(res, result.status, result.state);
      return true;
    }
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

/** `/health/...` requests, which answer in the shapes above rather than the `{ ok, data }` of /api. */
export const healthRoutes: RouteGroup = async ({ req, res, url }) => {
  if (!url.pathname.startsWith('/health/')) return false;
  try {
    if (mediaRoute(req, res, url)) return true;
    const user = requireUser(req);
    if (!(await handle(req, res, url, user))) throw new ApiError('not_found', 'Not found.');
  } catch (error) {
    if (!res.headersSent) fail(res, error, url.pathname);
  }
  return true;
};
