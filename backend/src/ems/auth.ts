import { randomBytes, randomInt, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { promisify } from 'node:util';

import type { Role, User } from '../../../shared/contracts/auth.ts';
import { config } from '../config.ts';
import { ApiError } from '../errors.ts';
import { trimmedText } from '../lib/text.ts';
import { activeSessionHashes, findToken, insertToken, revokeTokenAndChildren, revokeUserTokens, type TokenKind, type TokenRow } from '../repositories/tokens.ts';
import { countAdmins, findUserByEmail, findUserById, findUserWithPassword, insertUser, setMustChangePassword, updatePasswordHash } from '../repositories/users.ts';
import { newToken, sha256 } from './secrets.ts';

/**
 * EMS accounts and the bearer tokens EMS issues: `session` tokens for the
 * mobile app, from /api/auth/login, and short-lived `assistant` tokens a
 * session hands to the Parklane Assistant so it can drive the resident's
 * devices. The routes (src/routes/) decide which take which kind.
 */

export type { Role, TokenKind, User };
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

/** How an account is looked up: its email or, for the default account, its username. */
export const loginOf = (value: unknown) => (typeof value === 'string' ? value.trim().toLowerCase() : '');

/**
 * The ready-made sign-in from the settings, made on starting if it is not there yet and never
 * overwritten, so a password changed later stays changed. A username and a short password are
 * allowed here only: createUser's rules are for the accounts people make themselves.
 */
export async function ensureDefaultAccount(): Promise<void> {
  const username = loginOf(config.ems.defaultAccount.username);
  const { password } = config.ems.defaultAccount;
  if (!username || !password || findUserByEmail(username)) {
    return;
  }
  const user: User = { id: randomUUID(), email: username, name: username.toUpperCase(), role: 'resident' };
  insertUser(user, await hashPassword(password), new Date().toISOString());
}

/** `role` is only ever set by the clinic CLI; the register route always makes a resident. */
export async function createUser(emailInput: unknown, passwordInput: unknown, nameInput: unknown, role: Role = 'resident'): Promise<User> {
  const email = normalizeEmail(emailInput);
  const password = typeof passwordInput === 'string' ? passwordInput : '';
  if (password.length < 8 || password.length > 128) {
    throw new ApiError('bad_request', 'The password must be 8 to 128 characters.');
  }
  const name = trimmedText(nameInput) || email.split('@')[0];
  const user: User = { id: randomUUID(), email, name, role };
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
  const password = typeof passwordInput === 'string' ? passwordInput : '';
  const row = findUserWithPassword(loginOf(emailInput));
  const matches = await passwordMatches(password, row?.password_hash ?? DUMMY_HASH);
  if (!row || !matches) {
    throw new ApiError('unauthorized', 'Wrong email or password.');
  }
  const { password_hash: _hash, ...user } = row;
  return user;
}

// ---- temporary passwords and the admin account ----

const TEMPORARY_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789'; // nothing that reads alike

/** A password to hand over once: 14 characters, never stored as issued. */
export const temporaryPassword = () => Array.from({ length: 14 }, () => TEMPORARY_ALPHABET[randomInt(TEMPORARY_ALPHABET.length)]).join('');

/**
 * An account building management creates for a resident (or another admin), with a temporary password the
 * person must replace at first sign-in. Returns the password once; only its hash is kept.
 */
export async function createAccountWithTemporaryPassword(emailInput: unknown, nameInput: unknown, roleInput: unknown) {
  const email = normalizeEmail(emailInput);
  const role: Role = roleInput === 'admin' ? 'admin' : roleInput === 'security' ? 'security' : 'resident';
  const password = temporaryPassword();
  const user: User = { id: randomUUID(), email, name: trimmedText(nameInput) || email.split('@')[0], role };
  try {
    insertUser(user, await hashPassword(password), new Date().toISOString(), true);
  } catch (error) {
    if (/UNIQUE/.test((error as Error).message)) {
      throw new ApiError('conflict', 'An EMS account with this email already exists.');
    }
    throw error;
  }
  return { user: { ...user, mustChangePassword: true }, temporaryPassword: password };
}

/** Admin: a new temporary password; every session of the account ends and it must choose its own again. */
export async function resetToTemporaryPassword(userId: string): Promise<{ temporaryPassword: string }> {
  if (!findUserById(userId)) {
    throw new ApiError('not_found', 'No such account.');
  }
  const password = temporaryPassword();
  updatePasswordHash(userId, await hashPassword(password));
  setMustChangePassword(userId, true);
  revokeTokens(userId, ['session', 'assistant']);
  return { temporaryPassword: password };
}

/** The signed-in person replaces their password (a temporary one, or any). Their other sessions end. */
export async function changeOwnPassword(user: User, currentInput: unknown, nextInput: unknown, keepTokenHash: string): Promise<User> {
  await verifyCredentials(user.email, currentInput).catch(() => {
    throw new ApiError('unauthorized', 'The current password isn\'t right.');
  });
  const next = typeof nextInput === 'string' ? nextInput : '';
  if (next.length < 10 || next.length > 128) {
    throw new ApiError('bad_request', 'Choose a password of 10 to 128 characters.');
  }
  if (next === currentInput || next.trim().toLowerCase() === user.email) {
    throw new ApiError('bad_request', 'Choose a password that is new and isn\'t your email.');
  }
  updatePasswordHash(user.id, await hashPassword(next));
  setMustChangePassword(user.id, false);
  for (const hash of activeSessionHashes(user.id, Date.now())) {
    if (hash !== keepTokenHash) {
      revokeTokenAndChildren(hash, Date.now());
    }
  }
  return findUserById(user.id)!;
}

/**
 * The first admin, made on starting when there is none: `EMS_ADMIN_USERNAME` (default `admin`) with
 * `EMS_ADMIN_PASSWORD`, or a generated password printed once to the console. Either way it must be changed at
 * the first sign-in. Not the public demo account.
 */
export async function ensureAdminAccount(): Promise<void> {
  const { username: login, password: configured } = config.ems.adminAccount;
  const username = loginOf(login);
  if (!username || countAdmins() > 0) {
    return;
  }
  if (findUserByEmail(username)) {
    console.warn(`EMS: no admin account exists, and "${username}" is taken by another account. Set EMS_ADMIN_USERNAME.`);
    return;
  }
  const password = configured || temporaryPassword();
  const user: User = { id: randomUUID(), email: username, name: 'Building management', role: 'admin' };
  insertUser(user, await hashPassword(password), new Date().toISOString(), true);
  if (!configured) {
    // Printed rather than logged as a field, like the gateway's setup code: it's needed once, by whoever runs the server.
    console.log(
      [
        '',
        '='.repeat(64),
        '  EMS admin account created for the admin dashboard (/admin).',
        `  Username: ${username}`,
        `  Temporary password: ${password}`,
        '  You will be asked to choose your own password at the first sign-in.',
        '='.repeat(64),
        '',
      ].join('\n'),
    );
  }
}

/** For the clinic CLI: a doctor's or desk account's new password. Every session signed in with the old one ends. */
export async function setPassword(userId: string, passwordInput: unknown): Promise<void> {
  const password = typeof passwordInput === 'string' ? passwordInput : '';
  if (password.length < 10 || password.length > 128) {
    throw new ApiError('bad_request', 'Clinic passwords must be 10 to 128 characters.');
  }
  updatePasswordHash(userId, await hashPassword(password));
  revokeTokens(userId, ['session']);
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

/** Doctors and desk staff work on shared clinic machines, so their sessions are hours, not the app's 30 days. */
export const createSession = (userId: string, role: Role = 'resident') =>
  issueToken(userId, 'session', Date.now() + (role === 'resident' ? config.ems.sessionTtlMs : config.clinic.staffSessionTtlMs));

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

/**
 * The user behind a request and the kind of token they sent, or 401. An account still on a temporary password gets
 * 403 `password_change_required`, except where `pendingOk` (reading itself, signing out, changing the password).
 */
export function authenticate(
  req: IncomingMessage,
  kinds: readonly TokenKind[] = ['session'],
  { pendingOk = false }: { pendingOk?: boolean } = {},
): { user: User; kind: TokenKind } {
  const found = lookupToken(bearerOf(req), kinds);
  if (!found) {
    throw new ApiError('unauthorized', 'Sign in to your EMS account again.');
  }
  if (found.user.mustChangePassword && !pendingOk) {
    throw new ApiError('password_change_required', 'Choose your own password first: your account still has a temporary one.');
  }
  return { user: found.user, kind: found.kind };
}

/** The signed-in user behind a request, or 401. */
export const requireUser = (req: IncomingMessage, kinds: readonly TokenKind[] = ['session'], options: { pendingOk?: boolean } = {}): User =>
  authenticate(req, kinds, options).user;

/** The signed-in user, who must hold one of `roles` (403 otherwise). */
export function requireRole(req: IncomingMessage, roles: readonly Role[]): User {
  const user = requireUser(req);
  if (!roles.includes(user.role)) {
    throw new ApiError('forbidden', 'This account cannot use this part of the clinic.');
  }
  return user;
}
