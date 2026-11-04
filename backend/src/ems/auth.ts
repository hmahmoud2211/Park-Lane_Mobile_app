import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { promisify } from 'node:util';

import type { User } from '../../../shared/contracts/auth.ts';
import { config } from '../config.ts';
import { ApiError } from '../errors.ts';
import { db } from './db.ts';
import { newToken, sha256 } from './secrets.ts';

/**
 * EMS accounts and the bearer tokens EMS issues: `session` tokens for the
 * mobile app, from /api/auth/login, and short-lived `assistant` tokens a
 * session hands to the Parklane Assistant so it can drive the resident's
 * devices. app.ts decides which routes take which kind.
 */

export type { User };

export type TokenKind = 'session' | 'assistant';

const scryptAsync = promisify(scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scryptAsync(password, salt, 32);
  return `scrypt$${salt.toString('base64url')}$${hash.toString('base64url')}`;
}

async function passwordMatches(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) {
    return false;
  }
  const expected = Buffer.from(hash, 'base64url');
  const actual = await scryptAsync(password, Buffer.from(salt, 'base64url'), expected.length);
  return timingSafeEqual(actual, expected);
}

/** Spent on unknown emails too, so a login's timing does not say whether an account exists. */
const DUMMY_HASH = await hashPassword(randomBytes(12).toString('base64url'));

export function normalizeEmail(value: unknown): string {
  const email = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!EMAIL.test(email)) {
    throw new ApiError('bad_request', 'Enter a valid email address.');
  }
  return email;
}

export async function createUser(emailInput: unknown, passwordInput: unknown, nameInput: unknown): Promise<User> {
  const email = normalizeEmail(emailInput);
  const password = typeof passwordInput === 'string' ? passwordInput : '';
  if (password.length < 8 || password.length > 128) {
    throw new ApiError('bad_request', 'The password must be 8 to 128 characters.');
  }
  const name = typeof nameInput === 'string' && nameInput.trim() ? nameInput.trim().slice(0, 64) : email.split('@')[0];
  const user: User = { id: randomUUID(), email, name };
  const passwordHash = await hashPassword(password);
  try {
    db()
      .prepare('INSERT INTO users (id, email, name, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(user.id, email, name, passwordHash, new Date().toISOString());
  } catch (error) {
    if (/UNIQUE/.test((error as Error).message)) {
      throw new ApiError('conflict', 'An EMS account with this email already exists.');
    }
    throw error;
  }
  return user;
}

export async function verifyCredentials(emailInput: unknown, passwordInput: unknown): Promise<User> {
  const email = typeof emailInput === 'string' ? emailInput.trim().toLowerCase() : '';
  const password = typeof passwordInput === 'string' ? passwordInput : '';
  const row = db().prepare('SELECT id, email, name, password_hash FROM users WHERE email = ?').get(email) as
    | (User & { password_hash: string })
    | undefined;
  const matches = await passwordMatches(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !matches) {
    throw new ApiError('unauthorized', 'Wrong email or password.');
  }
  return { id: row.id, email: row.email, name: row.name };
}

export function getUser(id: string): User | null {
  return (db().prepare('SELECT id, email, name FROM users WHERE id = ?').get(id) as User | undefined) ?? null;
}

export function findUserByEmail(email: string): User | null {
  return (db().prepare('SELECT id, email, name FROM users WHERE email = ?').get(email) as User | undefined) ?? null;
}

export function issueToken(
  userId: string,
  kind: TokenKind,
  expiresAt: number,
  { clientId = null, parentHash = null }: { clientId?: string | null; parentHash?: string | null } = {},
): string {
  const token = newToken();
  db()
    .prepare(
      'INSERT INTO tokens (token_hash, user_id, kind, client_id, parent_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    )
    .run(sha256(token), userId, kind, clientId, parentHash, expiresAt, Date.now());
  return token;
}

export const createSession = (userId: string) => issueToken(userId, 'session', Date.now() + config.ems.sessionTtlMs);

/**
 * An assistant token for the session behind `sessionToken`: it never outlives
 * that session, and signing out (revokeToken) ends it.
 */
export function createAssistantToken(sessionToken: string): { token: string; expiresAt: number } {
  const session = lookupToken(sessionToken, ['session']);
  if (!session) {
    throw new ApiError('unauthorized', 'Sign in to your EMS account again.');
  }
  const expiresAt = Math.min(Date.now() + config.ems.assistantTokenTtlMs, session.expires_at);
  const token = issueToken(session.user_id, 'assistant', expiresAt, { parentHash: sha256(sessionToken) });
  return { token, expiresAt };
}

interface TokenRow {
  user_id: string;
  kind: TokenKind;
  client_id: string | null;
  expires_at: number;
  revoked_at: number | null;
}

/** The token's row when it is live, else null. */
export function lookupToken(token: string, kinds: readonly TokenKind[]): (TokenRow & { user: User }) | null {
  if (!token) {
    return null;
  }
  const row = db()
    .prepare('SELECT user_id, kind, client_id, expires_at, revoked_at FROM tokens WHERE token_hash = ?')
    .get(sha256(token)) as TokenRow | undefined;
  if (!row || row.revoked_at !== null || row.expires_at <= Date.now() || !kinds.includes(row.kind)) {
    return null;
  }
  const user = getUser(row.user_id);
  return user ? { ...row, user } : null;
}

/** The token, and any assistant tokens issued under it. */
export function revokeToken(token: string): void {
  const hash = sha256(token);
  db()
    .prepare('UPDATE tokens SET revoked_at = ? WHERE (token_hash = ? OR parent_hash = ?) AND revoked_at IS NULL')
    .run(Date.now(), hash, hash);
}

/** Every token of these kinds for the user. */
export function revokeTokens(userId: string, kinds: readonly TokenKind[]): void {
  const placeholders = kinds.map(() => '?').join(', ');
  db()
    .prepare(`UPDATE tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND kind IN (${placeholders})`)
    .run(Date.now(), userId, ...kinds);
}

export function bearerOf(req: IncomingMessage): string {
  const header = req.headers.authorization ?? '';
  return header.startsWith('Bearer ') ? header.slice(7).trim() : '';
}

/** The user behind a request and the kind of token they sent, or 401. */
export function authenticate(req: IncomingMessage, kinds: readonly TokenKind[] = ['session']): { user: User; kind: TokenKind } {
  const found = lookupToken(bearerOf(req), kinds);
  if (!found) {
    throw new ApiError('unauthorized', 'Sign in to your EMS account again.');
  }
  return { user: found.user, kind: found.kind };
}

/** The signed-in user behind a request, or 401. */
export const requireUser = (req: IncomingMessage, kinds: readonly TokenKind[] = ['session']): User => authenticate(req, kinds).user;
