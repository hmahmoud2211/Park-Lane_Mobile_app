import type { ServerResponse } from 'node:http';

import { config } from '../config.ts';
import { ApiError } from '../errors.ts';
import { redirect } from '../http.ts';
import { log } from '../log.ts';
import { revokeTokens, type User } from './auth.ts';
import { db } from './db.ts';
import { publish } from './events.ts';
import { issueAuthCode } from './oauth.ts';
import { newToken, seal, sha256, unseal } from './secrets.ts';

/**
 * App-initiated account linking, so the customer never needs the Alexa app:
 *
 *   1. The app asks POST /api/integrations/alexa/link/start and opens the
 *      Login with Amazon URL it gets back in the system browser.
 *   2. The customer signs in to Amazon and approves. LWA redirects to
 *      GET /alexa/link/callback?code&state (this backend, HTTPS).
 *   3. The backend checks `state`, exchanges Amazon's code (with the PKCE
 *      verifier) for the customer's Amazon token, finds their Alexa region,
 *      issues an EMS authorization code, and calls the Skill Enablement API.
 *   4. Amazon redeems the EMS code at /oauth/token. Only when the Enablement
 *      API answers accountLink.status = LINKED is the link recorded.
 *   5. The browser is sent back to the app (APP_RETURN_URL?result=…).
 *
 * Amazon's tokens are kept sealed, only to check and remove the link later.
 */

export type LinkStatus = 'linked' | 'unlinked' | 'failed' | 'expired';

export interface AlexaStatus {
  configured: boolean;
  status: LinkStatus;
  /** How the current link was made: from this app, or from the Alexa app/web. */
  via: 'app' | 'alexa' | null;
  linkedAt: string | null;
  lastCheckedAt: string | null;
  lastError: string | null;
  skillStage: string;
}

interface LinkRow {
  user_id: string;
  status: LinkStatus;
  amazon_refresh_token: string | null;
  amazon_access_token: string | null;
  amazon_access_expires_at: number | null;
  api_endpoint: string | null;
  linked_at: string | null;
  checked_at: number | null;
  last_error: string | null;
}

const STATE_TTL_MS = 10 * 60_000;
const AMAZON_TIMEOUT_MS = 10_000;
const REGIONS = ['https://api.amazonalexa.com', 'https://api.eu.amazonalexa.com', 'https://api.fe.amazonalexa.com'];

export function isConfigured(): boolean {
  const { skillId, lwaClientId, lwaClientSecret, oauthClientId, oauthClientSecret } = config.alexa;
  return Boolean(config.ems.publicUrl && skillId && lwaClientId && lwaClientSecret && oauthClientId && oauthClientSecret);
}

const callbackUrl = () => `${config.ems.publicUrl}/alexa/link/callback`;

function requireConfigured() {
  if (!isConfigured()) {
    throw new ApiError(
      'not_configured',
      'Alexa linking is not set up on the backend yet (see ALEXA_INTEGRATION.md, "Backend settings").',
    );
  }
}

function linkRow(userId: string): LinkRow | undefined {
  return db().prepare('SELECT * FROM alexa_links WHERE user_id = ?').get(userId) as LinkRow | undefined;
}

function saveLink(userId: string, changes: Partial<Omit<LinkRow, 'user_id'>>) {
  const current = linkRow(userId);
  const next = { status: 'unlinked', ...current, ...changes } as LinkRow;
  db()
    .prepare(
      `INSERT INTO alexa_links (user_id, status, amazon_refresh_token, amazon_access_token, amazon_access_expires_at,
         api_endpoint, linked_at, checked_at, last_error, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET status = excluded.status, amazon_refresh_token = excluded.amazon_refresh_token,
         amazon_access_token = excluded.amazon_access_token, amazon_access_expires_at = excluded.amazon_access_expires_at,
         api_endpoint = excluded.api_endpoint, linked_at = excluded.linked_at, checked_at = excluded.checked_at,
         last_error = excluded.last_error, updated_at = excluded.updated_at`,
    )
    .run(
      userId,
      next.status,
      next.amazon_refresh_token ?? null,
      next.amazon_access_token ?? null,
      next.amazon_access_expires_at ?? null,
      next.api_endpoint ?? null,
      next.linked_at ?? null,
      next.checked_at ?? null,
      next.last_error ?? null,
      new Date().toISOString(),
    );
  if (current?.status !== next.status) {
    publish(userId, { type: 'alexa', status: next.status });
  }
}

/** Alexa holds a live EMS refresh token for this user (however the link was made). */
function hasAlexaTokens(userId: string): boolean {
  return Boolean(
    db()
      .prepare("SELECT 1 FROM tokens WHERE user_id = ? AND kind = 'alexa_refresh' AND revoked_at IS NULL AND expires_at > ? LIMIT 1")
      .get(userId, Date.now()),
  );
}

// ---- Talking to Amazon -----------------------------------------------------------------

async function amazon(url: string, init: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, signal: AbortSignal.timeout(AMAZON_TIMEOUT_MS) });
  } catch {
    throw new ApiError('amazon_error', 'Amazon could not be reached. Try again in a moment.');
  }
  const text = await response.text();
  let body: Record<string, unknown> = {};
  try {
    body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    body = {};
  }
  return { status: response.status, body };
}

interface LwaTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

async function lwaToken(params: Record<string, string>): Promise<LwaTokens> {
  const { status, body } = await amazon(config.alexa.lwaTokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', Accept: 'application/json' },
    body: new URLSearchParams({
      ...params,
      client_id: config.alexa.lwaClientId,
      client_secret: config.alexa.lwaClientSecret,
    }).toString(),
  });
  if (status === 200 && typeof body.access_token === 'string') {
    return body as unknown as LwaTokens;
  }
  if (body.error === 'invalid_grant') {
    throw new ApiError('link_expired', 'Amazon no longer accepts this authorization. Connect Alexa again.');
  }
  log.warn('Login with Amazon token request failed', { status, error: body.error });
  throw new ApiError('amazon_error', 'Login with Amazon refused the request.');
}

/** The customer's regional Alexa API hosts; all three when Amazon cannot say. */
async function alexaEndpoints(accessToken: string): Promise<string[]> {
  try {
    const { status, body } = await amazon(`${config.alexa.apiUrl}/v1/alexaApiEndpoint`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    const listed = Array.isArray(body.endpoints) ? body.endpoints.filter((entry): entry is string => typeof entry === 'string') : [];
    if (status === 200 && listed.length > 0) {
      return listed.map((entry) => (entry.startsWith('http') ? entry : `https://${entry}`).replace(/\/+$/, ''));
    }
  } catch {
    // Fall through to every region.
  }
  return REGIONS;
}

const enablementUrl = (base: string) =>
  `${base}/v1/users/~current/skills/${encodeURIComponent(config.alexa.skillId)}/enablement`;

/** A current Amazon access token for the user, refreshed when needed. */
async function amazonAccessToken(userId: string): Promise<string> {
  const row = linkRow(userId);
  if (!row?.amazon_refresh_token) {
    throw new ApiError('link_expired', 'There is no Amazon authorization for this account.');
  }
  if (row.amazon_access_token && (row.amazon_access_expires_at ?? 0) > Date.now() + 60_000) {
    return unseal(row.amazon_access_token);
  }
  const fresh = await lwaToken({ grant_type: 'refresh_token', refresh_token: unseal(row.amazon_refresh_token) });
  saveLink(userId, {
    amazon_access_token: seal(fresh.access_token),
    amazon_access_expires_at: Date.now() + fresh.expires_in * 1000,
    amazon_refresh_token: fresh.refresh_token ? seal(fresh.refresh_token) : row.amazon_refresh_token,
  });
  return fresh.access_token;
}

// ---- 1. Start ----------------------------------------------------------------------------

export function startLink(user: User): { url: string; expiresAt: string } {
  requireConfigured();
  const state = newToken();
  const verifier = newToken();
  const expiresAt = Date.now() + STATE_TTL_MS;
  db().prepare('DELETE FROM link_states WHERE expires_at < ?').run(Date.now());
  db()
    .prepare('INSERT INTO link_states (state_hash, user_id, code_verifier, expires_at) VALUES (?, ?, ?, ?)')
    .run(sha256(state), user.id, seal(verifier), expiresAt);

  const url = new URL(config.alexa.lwaAuthorizeUrl);
  url.search = new URLSearchParams({
    client_id: config.alexa.lwaClientId,
    scope: 'alexa::skills:account_linking',
    response_type: 'code',
    redirect_uri: callbackUrl(),
    state,
    code_challenge: sha256(verifier),
    code_challenge_method: 'S256',
  }).toString();
  return { url: url.toString(), expiresAt: new Date(expiresAt).toISOString() };
}

// ---- 2–5. Callback ---------------------------------------------------------------------

function backToApp(res: ServerResponse, result: 'linked' | 'cancelled' | 'failed', reason?: string) {
  const target = new URL(config.alexa.appReturnUrl);
  target.searchParams.set('result', result);
  if (reason) {
    target.searchParams.set('reason', reason);
  }
  redirect(res, target.toString());
}

async function enableSkill(userId: string, amazonToken: string): Promise<string> {
  let lastError = 'Amazon did not confirm the link.';
  for (const base of await alexaEndpoints(amazonToken)) {
    // A fresh EMS code per attempt: Amazon redeems it, so a failed region must not spend the next one's.
    const verifier = newToken();
    const authCode = issueAuthCode(userId, config.alexa.oauthClientId, callbackUrl(), sha256(verifier));
    const { status, body } = await amazon(enablementUrl(base), {
      method: 'POST',
      headers: { Authorization: `Bearer ${amazonToken}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        stage: config.alexa.skillStage,
        accountLinkRequest: { redirectUri: callbackUrl(), authCode, type: 'AUTH_CODE', authCodeVerifier: verifier },
      }),
    });
    const accountLink = body.accountLink as { status?: string } | undefined;
    if ((status === 200 || status === 201) && accountLink?.status === 'LINKED') {
      return base;
    }
    lastError = typeof body.message === 'string' ? body.message : `Amazon answered ${status}.`;
    log.warn('Skill enablement not confirmed', { status, region: new URL(base).host });
  }
  throw new ApiError('amazon_error', lastError);
}

export async function linkCallback(res: ServerResponse, url: URL) {
  const state = url.searchParams.get('state') ?? '';
  const row = state
    ? (db().prepare('SELECT * FROM link_states WHERE state_hash = ?').get(sha256(state)) as
        | { user_id: string; code_verifier: string; expires_at: number }
        | undefined)
    : undefined;
  if (row) {
    // Single use, whatever happens next.
    db().prepare('DELETE FROM link_states WHERE state_hash = ?').run(sha256(state));
  }
  if (!row || row.expires_at < Date.now()) {
    backToApp(res, 'failed', 'expired');
    return;
  }
  const userId = row.user_id;

  const amazonError = url.searchParams.get('error');
  if (amazonError) {
    const cancelled = amazonError === 'access_denied';
    saveLink(userId, { last_error: cancelled ? 'You cancelled the Amazon sign-in.' : `Amazon: ${amazonError}` });
    backToApp(res, cancelled ? 'cancelled' : 'failed', cancelled ? undefined : 'amazon');
    return;
  }

  try {
    const tokens = await lwaToken({
      grant_type: 'authorization_code',
      code: url.searchParams.get('code') ?? '',
      redirect_uri: callbackUrl(),
      code_verifier: unseal(row.code_verifier),
    });
    const endpoint = await enableSkill(userId, tokens.access_token);
    saveLink(userId, {
      status: 'linked',
      amazon_access_token: seal(tokens.access_token),
      amazon_access_expires_at: Date.now() + tokens.expires_in * 1000,
      amazon_refresh_token: tokens.refresh_token ? seal(tokens.refresh_token) : null,
      api_endpoint: endpoint,
      linked_at: new Date().toISOString(),
      checked_at: Date.now(),
      last_error: null,
    });
    log.info('Alexa skill enabled and account linked', { region: new URL(endpoint).host });
    backToApp(res, 'linked');
  } catch (error) {
    const message = error instanceof ApiError ? error.message : 'Linking failed.';
    saveLink(userId, { status: 'failed', last_error: message });
    backToApp(res, 'failed', 'amazon');
  }
}

// ---- Status and unlink -------------------------------------------------------------------

function view(userId: string): AlexaStatus {
  const row = linkRow(userId);
  const tokensLive = hasAlexaTokens(userId);
  let status: LinkStatus = row?.status ?? 'unlinked';
  let via: AlexaStatus['via'] = row?.status === 'linked' ? 'app' : null;
  // Linked from the Alexa app's skill page: Amazon holds our tokens, but we hold none of theirs.
  if (status !== 'linked' && status !== 'expired' && tokensLive) {
    status = 'linked';
    via = 'alexa';
  }
  return {
    configured: isConfigured(),
    status,
    via,
    linkedAt: row?.linked_at ?? null,
    lastCheckedAt: row?.checked_at ? new Date(row.checked_at).toISOString() : null,
    lastError: row?.last_error ?? null,
    skillStage: config.alexa.skillStage,
  };
}

/** Re-asks Amazon whether the skill is still enabled and linked, at most once a minute unless forced. */
export async function linkStatus(user: User, force = false): Promise<AlexaStatus> {
  const row = linkRow(user.id);
  if (row?.status !== 'linked' || !row.api_endpoint || !isConfigured()) {
    return view(user.id);
  }
  if (!force && row.checked_at && Date.now() - row.checked_at < config.alexa.statusRecheckMs) {
    return view(user.id);
  }
  try {
    const token = await amazonAccessToken(user.id);
    const { status, body } = await amazon(enablementUrl(row.api_endpoint), {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
    });
    const accountLink = body.accountLink as { status?: string } | undefined;
    if (status === 200 && accountLink?.status === 'LINKED' && body.status !== 'NO_ASSOCIATION') {
      saveLink(user.id, { checked_at: Date.now(), last_error: null });
    } else if (status === 404 || status === 200) {
      // Disabled or unlinked from the Alexa side: Alexa's EMS tokens go too.
      revokeTokens(user.id, ['alexa_access', 'alexa_refresh']);
      saveLink(user.id, {
        status: 'unlinked',
        checked_at: Date.now(),
        amazon_access_token: null,
        amazon_refresh_token: null,
        last_error: 'The skill was disabled or unlinked in Alexa.',
      });
    } else if (status === 401) {
      saveLink(user.id, { status: 'expired', checked_at: Date.now(), last_error: 'Amazon authorization expired. Connect Alexa again.' });
    } else {
      saveLink(user.id, { checked_at: Date.now(), last_error: `Could not confirm with Amazon (answered ${status}).` });
    }
  } catch (error) {
    if (error instanceof ApiError && error.code === 'link_expired') {
      saveLink(user.id, { status: 'expired', checked_at: Date.now(), last_error: error.message });
    } else {
      saveLink(user.id, { last_error: error instanceof ApiError ? error.message : 'Could not confirm with Amazon.' });
    }
  }
  return view(user.id);
}

export async function unlink(user: User): Promise<AlexaStatus & { amazonConfirmed: boolean }> {
  const row = linkRow(user.id);
  let amazonConfirmed = false;
  let lastError: string | null = null;
  if (row?.amazon_refresh_token && row.api_endpoint && isConfigured()) {
    try {
      const token = await amazonAccessToken(user.id);
      const { status } = await amazon(enablementUrl(row.api_endpoint), {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
      });
      amazonConfirmed = status === 200 || status === 204 || status === 404;
      if (!amazonConfirmed) {
        lastError = `Amazon answered ${status}; EMS access for Alexa was still removed.`;
      }
    } catch (error) {
      lastError = `${error instanceof ApiError ? error.message : 'Amazon could not be reached.'} EMS access for Alexa was still removed.`;
    }
  }
  // Whatever Amazon said, Alexa's EMS tokens stop working now.
  revokeTokens(user.id, ['alexa_access', 'alexa_refresh']);
  saveLink(user.id, {
    status: 'unlinked',
    amazon_access_token: null,
    amazon_access_expires_at: null,
    amazon_refresh_token: null,
    api_endpoint: null,
    linked_at: null,
    checked_at: Date.now(),
    last_error: lastError,
  });
  return { ...view(user.id), amazonConfirmed };
}
