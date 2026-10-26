import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { config } from '../config.ts';
import { ApiError } from '../errors.ts';
import { escapeHtml, html, readForm, redirect, send } from '../http.ts';
import { log } from '../log.ts';
import { issueToken, lookupToken, revokeToken, verifyCredentials } from './auth.ts';
import { db } from './db.ts';
import { clientIp, limit } from './rateLimit.ts';
import { newToken, sha256 } from './secrets.ts';

/**
 * EMS as an OAuth 2.0 authorization server, for the skill's account linking
 * (Authorization Code grant, PKCE supported):
 *
 *   GET/POST /oauth/authorize  sign-in page, used when linking starts in the
 *                              Alexa app or web; redirects to Amazon with a code
 *   POST     /oauth/token      Alexa exchanges a code, or refreshes a token
 *
 * App-initiated linking (alexaLink.ts) skips the page: the signed-in app user
 * is issued a code directly, which Amazon then exchanges here.
 */

const CODE_TTL_MS = 5 * 60_000;

/** A single-use code for `userId`, redeemable only by `clientId` with the same redirect URI. */
export function issueAuthCode(userId: string, clientId: string, redirectUri: string, codeChallenge: string | null): string {
  const code = newToken();
  db()
    .prepare(
      'INSERT INTO oauth_codes (code_hash, user_id, client_id, redirect_uri, code_challenge, expires_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .run(sha256(code), userId, clientId, redirectUri, codeChallenge, Date.now() + CODE_TTL_MS);
  return code;
}

function sameSecret(given: string, expected: string): boolean {
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return expected.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

/** Codes may only go back to Amazon's own redirect URLs, or to our app-linking callback. */
export function allowedRedirect(uri: string): boolean {
  const own = config.ems.publicUrl ? `${config.ems.publicUrl}/alexa/link/callback` : '';
  return config.alexa.redirectUris.includes(uri) || (own !== '' && uri === own);
}

// ---- The sign-in page -------------------------------------------------------------------

interface AuthorizeParams {
  client_id: string;
  redirect_uri: string;
  state: string;
  response_type: string;
  code_challenge: string;
  code_challenge_method: string;
}

function params(source: Record<string, string>): AuthorizeParams {
  const pick = (key: keyof AuthorizeParams) => (typeof source[key] === 'string' ? source[key].slice(0, 2048) : '');
  return {
    client_id: pick('client_id'),
    redirect_uri: pick('redirect_uri'),
    state: pick('state'),
    response_type: pick('response_type'),
    code_challenge: pick('code_challenge'),
    code_challenge_method: pick('code_challenge_method'),
  };
}

function page(values: AuthorizeParams, error?: string): string {
  const hidden = (Object.entries(values) as [string, string][])
    .map(([key, value]) => `<input type="hidden" name="${key}" value="${escapeHtml(value)}">`)
    .join('');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Link EMS to Alexa</title>
<style>
  :root { color-scheme: light dark; }
  body { font-family: system-ui, -apple-system, sans-serif; margin: 0; padding: 32px 16px; display: flex; justify-content: center; }
  main { width: 100%; max-width: 380px; }
  h1 { font-size: 1.4rem; margin: 0 0 8px; }
  p { line-height: 1.5; opacity: .8; }
  label { display: block; margin: 16px 0 6px; font-weight: 600; }
  input[type=email], input[type=password] { width: 100%; box-sizing: border-box; padding: 12px; font-size: 1rem; border-radius: 10px; border: 1px solid #8888; }
  button { margin-top: 24px; width: 100%; padding: 14px; font-size: 1rem; font-weight: 600; border: 0; border-radius: 10px; background: #2f6fed; color: #fff; }
  .error { color: #d33; font-weight: 600; }
</style></head>
<body><main>
  <h1>Link your EMS account</h1>
  <p>Sign in so Alexa can switch the devices you allow in the EMS app.</p>
  ${error ? `<p class="error" role="alert">${escapeHtml(error)}</p>` : ''}
  <form method="post" action="/oauth/authorize">
    ${hidden}
    <label for="email">Email</label><input id="email" name="email" type="email" autocomplete="username" required>
    <label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required>
    <button type="submit">Sign in and link</button>
  </form>
</main></body></html>`;
}

function checkClient(values: AuthorizeParams) {
  if (!config.alexa.oauthClientId || values.client_id !== config.alexa.oauthClientId) {
    throw new ApiError('bad_request', 'Unknown client.');
  }
  // Never redirect anywhere not registered: the code would leak to it.
  if (!allowedRedirect(values.redirect_uri)) {
    throw new ApiError('bad_request', 'This redirect URI is not registered.');
  }
  if (values.response_type !== 'code') {
    throw new ApiError('bad_request', 'Only response_type=code is supported.');
  }
  if (values.code_challenge && values.code_challenge_method !== 'S256') {
    throw new ApiError('bad_request', 'Only the S256 code challenge method is supported.');
  }
}

export async function authorizePage(req: IncomingMessage, res: ServerResponse, url: URL) {
  const values = params(Object.fromEntries(url.searchParams));
  checkClient(values);
  html(res, 200, page(values));
}

export async function authorizeSubmit(req: IncomingMessage, res: ServerResponse) {
  limit('oauth-login', clientIp(req), 10, 60_000);
  const form = await readForm(req);
  const values = params(form);
  checkClient(values);
  let userId: string;
  try {
    userId = (await verifyCredentials(form.email, form.password)).id;
  } catch {
    html(res, 401, page(values, 'Wrong email or password.'));
    return;
  }
  const code = issueAuthCode(userId, values.client_id, values.redirect_uri, values.code_challenge || null);
  const target = new URL(values.redirect_uri);
  target.searchParams.set('code', code);
  if (values.state) {
    target.searchParams.set('state', values.state);
  }
  redirect(res, target.toString());
}

// ---- The token endpoint ----------------------------------------------------------------

function oauthError(res: ServerResponse, status: number, error: string, description: string) {
  send(res, status, { error, error_description: description }, { Pragma: 'no-cache' });
}

function clientCredentials(req: IncomingMessage, form: Record<string, string>): { id: string; secret: string } {
  const header = req.headers.authorization ?? '';
  if (header.startsWith('Basic ')) {
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const split = decoded.indexOf(':');
    return {
      id: decodeURIComponent(decoded.slice(0, split)),
      secret: decodeURIComponent(decoded.slice(split + 1)),
    };
  }
  return { id: form.client_id ?? '', secret: form.client_secret ?? '' };
}

function tokenPair(userId: string, clientId: string) {
  return {
    access_token: issueToken(userId, 'alexa_access', config.alexa.accessTokenTtlS * 1000, clientId),
    token_type: 'bearer',
    expires_in: config.alexa.accessTokenTtlS,
    refresh_token: issueToken(userId, 'alexa_refresh', config.alexa.refreshTokenTtlMs, clientId),
  };
}

interface CodeRow {
  user_id: string;
  client_id: string;
  redirect_uri: string;
  code_challenge: string | null;
  expires_at: number;
  used_at: number | null;
}

export async function token(req: IncomingMessage, res: ServerResponse) {
  limit('oauth-token', clientIp(req), 60, 60_000);
  const form = await readForm(req);
  const client = clientCredentials(req, form);
  if (!sameSecret(client.id, config.alexa.oauthClientId) || !sameSecret(client.secret, config.alexa.oauthClientSecret)) {
    oauthError(res, 401, 'invalid_client', 'Client authentication failed.');
    return;
  }

  if (form.grant_type === 'authorization_code') {
    const hash = sha256(form.code ?? '');
    const row = db().prepare('SELECT * FROM oauth_codes WHERE code_hash = ?').get(hash) as CodeRow | undefined;
    const valid =
      row &&
      row.used_at === null &&
      row.expires_at > Date.now() &&
      row.client_id === client.id &&
      row.redirect_uri === form.redirect_uri &&
      (!row.code_challenge || sha256(form.code_verifier ?? '') === row.code_challenge);
    if (!row || !valid) {
      if (row) {
        db().prepare('UPDATE oauth_codes SET used_at = COALESCE(used_at, ?) WHERE code_hash = ?').run(Date.now(), hash);
      }
      oauthError(res, 400, 'invalid_grant', 'The authorization code is invalid, expired or already used.');
      return;
    }
    db().prepare('UPDATE oauth_codes SET used_at = ? WHERE code_hash = ?').run(Date.now(), hash);
    log.info('Alexa redeemed an EMS authorization code');
    send(res, 200, tokenPair(row.user_id, client.id), { Pragma: 'no-cache' });
    return;
  }

  if (form.grant_type === 'refresh_token') {
    const current = lookupToken(form.refresh_token ?? '', ['alexa_refresh']);
    if (!current || current.client_id !== client.id) {
      oauthError(res, 400, 'invalid_grant', 'The refresh token is invalid or revoked.');
      return;
    }
    // Rotated: the old refresh token stops working once a new pair exists.
    revokeToken(form.refresh_token);
    send(res, 200, tokenPair(current.user_id, client.id), { Pragma: 'no-cache' });
    return;
  }

  oauthError(res, 400, 'unsupported_grant_type', 'Use authorization_code or refresh_token.');
}
