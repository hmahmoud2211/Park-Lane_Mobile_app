import { randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { promisify } from 'node:util';

import type { User } from '../../../shared/contracts/auth.ts';
import { config } from '../config.ts';
import { ApiError } from '../errors.ts';
import { trimmedText } from '../lib/text.ts';
import { findToken, insertToken, revokeTokenAndChildren, revokeUserTokens, type TokenKind, type TokenRow } from '../repositories/tokens.ts';
import { findUserById, findUserWithPassword, insertUser } from '../repositories/users.ts';
import { newToken, sha256 } from './secrets.ts';

/**
 * EMS accounts and the bearer tokens EMS issues: `session` tokens for the
 * mobile app, from /api/auth/login, and short-lived `assistant` tokens a
 * session hands to the Parklane Assistant so it can drive the resident's
 * devices. The routes (src/routes/) decide which take which kind.
 */

export type { TokenKind, User };
export { findUserByEmail } from '../repositories/users.ts';

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
  const name = trimmedText(nameInput) || email.split('@')[0];
  const user: User = { id: randomUUID(), email, name };
  const passwordHash = await hashPassword(password);
  try {
    insertUser(user, passwordHash, new Date().toISOString());
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
  const row = findUserWithPassword(email);
  const matches = await passwordMatches(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !matches) {
    throw new ApiError('unauthorized', 'Wrong email or password.');
  }
  return { id: row.id, email: row.email, name: row.name };
}

export function getUser(id: string): User | null {
  return findUserById(id);
}

export function issueToken(
  userId: string,
  kind: TokenKind,
  expiresAt: number,
  { clientId = null, parentHash = null }: { clientId?: string | null; parentHash?: string | null } = {},
): string {
  const token = newToken();
  insertToken({ hash: sha256(token), userId, kind, clientId, parentHash, expiresAt, createdAt: Date.now() });
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

/** The token's row when it is live, else null. */
export function lookupToken(token: string, kinds: readonly TokenKind[]): (TokenRow & { user: User }) | null {
  if (!token) {
    return null;
  }
  const row = findToken(sha256(token));
  if (!row || row.revoked_at !== null || row.expires_at <= Date.now() || !kinds.includes(row.kind)) {
    return null;
  }
  const user = getUser(row.user_id);
  return user ? { ...row, user } : null;
}

/** The token, and any assistant tokens issued under it. */
export function revokeToken(token: string): void {
  revokeTokenAndChildren(sha256(token), Date.now());
}

/** Every token of these kinds for the user. */
export function revokeTokens(userId: string, kinds: readonly TokenKind[]): void {
  revokeUserTokens(userId, kinds, Date.now());
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
