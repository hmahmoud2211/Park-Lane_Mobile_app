import { createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject, randomUUID, sign, timingSafeEqual } from 'node:crypto';

import type { GatewayPass } from '../../../shared/contracts/gateway.ts';
import { ApiError } from '../errors.ts';
import * as gateways from '../repositories/gateways.ts';
import { activeSessionHashes, revokeTokenAndChildren } from '../repositories/tokens.ts';
import { findUnitOfUser } from '../repositories/units.ts';
import { seal, sha256, unseal } from './secrets.ts';
import type { User } from './auth.ts';

/**
 * CUBE gateway access through EMS accounts.
 *
 * A resident's phone asks for a pass (passFor). The pass names the resident, their unit, their role there and the
 * one gateway it is for, and it lasts five minutes. It is signed with the backend's Ed25519 key, whose public half
 * every gateway pins (GET /api/gateway/key), so the gateway checks it without calling the backend, and then gives
 * that phone its own gateway token. Format: base64url(JSON payload) "." base64url(signature over the first part).
 *
 * Gateways prove themselves with the sync secret set when an admin attached them to a unit (stored hashed), and
 * use it to ask which residents are still members, so a resident who moves out loses every phone's access.
 *
 * A phone's gateway token lives as long as the app session that asked for its pass: the pass carries the session's
 * id (`sid`, a one-way fingerprint of the session, never the token), the members list says which sessions still
 * work, and the gateway removes phones whose session ended (signed out, signed out elsewhere, password changed).
 * The other way round, an owner removing a lost phone on the gateway ends that phone's session here
 * (revokeSessions), so the lost phone can't simply ask for a new pass.
 */

export const PASS_TTL_MS = 5 * 60_000;
const GATEWAY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
let cached: { privateKey: KeyObject; publicKey: string } | null = null;

/** The signing key, made on first use; the private half is stored sealed. */
export function signingKey(): { privateKey: KeyObject; publicKey: string } {
  if (cached) {
    return cached;
  }
  let stored = gateways.findSigningKey();
  if (!stored) {
    const { privateKey } = generateKeyPairSync('ed25519');
    const pem = privateKey.export({ format: 'pem', type: 'pkcs8' }).toString();
    gateways.insertSigningKey(seal(pem), String(createPublicKey(privateKey).export({ format: 'jwk' }).x), new Date().toISOString());
    stored = gateways.findSigningKey()!; // another process may have won the race: use whichever row exists
  }
  cached = { privateKey: createPrivateKey(unseal(stored.privateSealed)), publicKey: stored.publicKey };
  return cached;
}

/** For tests that reopen the database. */
export function forgetSigningKey(): void {
  cached = null;
}

/** What gateways pin: the raw Ed25519 public key, base64url. */
export const publicKey = () => ({ alg: 'Ed25519', key: signingKey().publicKey });

/** The public id of an app session: a one-way fingerprint of its token's hash. */
export const sessionIdOf = (tokenHash: string) => sha256(`gateway-session:${tokenHash}`).slice(0, 24);

export function passFor(user: User, sessionHash: string, now = Date.now()): GatewayPass {
  const unit = findUnitOfUser(user.id);
  const gateway = unit ? gateways.findGatewayOfUnit(unit.id) : null;
  if (!unit || !gateway) {
    throw new ApiError('no_gateway', 'Your apartment has no CUBE gateway linked to EMS yet. Ask building management.');
  }
  const role = gateways.membersOfGateway(gateway.id).find((member) => member.userId === user.id)?.role ?? 'member';
  const expiresAt = now + PASS_TTL_MS;
  const payload = {
    v: 1,
    sub: user.id,
    name: user.name || user.email,
    unit: unit.id,
    gw: gateway.id,
    role,
    iat: Math.floor(now / 1000),
    exp: Math.floor(expiresAt / 1000),
    jti: randomUUID(),
    sid: sessionIdOf(sessionHash),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = sign(null, Buffer.from(body), signingKey().privateKey).toString('base64url');
  return { gateway: { id: gateway.id, url: gateway.url }, pass: `${body}.${signature}`, expiresAt, role };
}

/** How a device call's bearer token starts; the gateway tells it from a phone's token by this. */
export const DEVICE_CALL_PREFIX = 'emscall.';
/** A device call lasts this long; the gateway refuses any that claims more than two minutes. */
export const DEVICE_CALL_TTL_MS = 60_000;

/**
 * The token for one request the backend makes to a unit's gateway for a resident (src/gateway/devices.ts): the
 * Parklane Assistant reading or driving their devices, which it can't reach itself. It names the gateway, the
 * resident and the exact method and path, is signed like a pass, lasts a minute and works once. The gateway accepts
 * it only for its device list, one device and device commands (gateway/cube_gateway/accounts.py `device_call`).
 * The caller has already checked the resident lives in the unit this gateway serves.
 */
export function deviceCallToken(userId: string, gatewayId: string, method: string, path: string, now = Date.now()): string {
  const payload = {
    v: 1,
    typ: 'device_call',
    sub: userId,
    gw: gatewayId,
    m: method.toUpperCase(),
    p: path,
    via: 'Parklane Assistant',
    iat: Math.floor(now / 1000),
    exp: Math.floor((now + DEVICE_CALL_TTL_MS) / 1000),
    jti: randomUUID(),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${DEVICE_CALL_PREFIX}${body}.${sign(null, Buffer.from(body), signingKey().privateKey).toString('base64url')}`;
}

/** Admin: attaches a gateway to a unit with its sync secret (the installer gives the same secret to the gateway). */
export function attachGateway(unitId: string, idInput: unknown, secretInput: unknown, urlInput: unknown) {
  const id = typeof idInput === 'string' ? idInput.trim().toLowerCase() : '';
  const secret = typeof secretInput === 'string' ? secretInput.trim() : '';
  const url = typeof urlInput === 'string' && urlInput.trim() ? urlInput.trim().replace(/\/+$/, '') : null;
  if (!GATEWAY_ID.test(id)) {
    throw new ApiError('bad_request', 'gatewayId must be the gateway\'s id (a UUID, from its /api/v1/health).');
  }
  if (secret.length < 32) {
    throw new ApiError('bad_request', 'secret must be at least 32 characters (e.g. openssl rand -hex 32).');
  }
  // https, or a relay on this machine (development and tests).
  if (url !== null && !/^(https:\/\/|http:\/\/(127\.0\.0\.1|localhost)[:/])[^\s]+$/.test(url)) {
    throw new ApiError('bad_request', 'url must be the gateway\'s https address on the relay.');
  }
  gateways.upsertGateway(id, unitId, url, sha256(secret), new Date().toISOString());
  return { id, unitId, url };
}

/** The gateway behind `Authorization: Bearer <gateway id>.<sync secret>`, or 401. */
export function authenticateGateway(header: string | undefined): gateways.Gateway {
  const value = header?.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const dot = value.indexOf('.');
  const id = dot > 0 ? value.slice(0, dot).toLowerCase() : '';
  const found = GATEWAY_ID.test(id) ? gateways.findGatewayWithSecret(id) : null;
  const offered = Buffer.from(sha256(value.slice(dot + 1)));
  const expected = Buffer.from(found?.secretHash ?? sha256('no gateway'));
  if (!found || offered.length !== expected.length || !timingSafeEqual(offered, expected)) {
    throw new ApiError('unauthorized', 'Unknown gateway or wrong secret.');
  }
  return found;
}

/** Who may use the gateway now, with the sessions still signed in; the gateway removes every other phone. */
export function membersFor(gateway: gateways.Gateway, now = Date.now()) {
  gateways.markSynced(gateway.id, new Date(now).toISOString());
  const members = gateways.membersOfGateway(gateway.id).map((member) => ({
    ...member,
    sessions: activeSessionHashes(member.userId, now).map(sessionIdOf),
  }));
  return { gatewayId: gateway.id, unitId: gateway.unitId, members };
}

/** Ends the sessions of phones an owner removed on the gateway; only sessions of the gateway's own residents. */
export function revokeSessions(gateway: gateways.Gateway, input: unknown, now = Date.now()): { revoked: number } {
  const wanted = new Set(Array.isArray(input) ? input.filter((sid): sid is string => typeof sid === 'string').slice(0, 100) : []);
  let revoked = 0;
  for (const member of gateways.membersOfGateway(gateway.id)) {
    for (const hash of activeSessionHashes(member.userId, now)) {
      if (wanted.has(sessionIdOf(hash))) {
        revokeTokenAndChildren(hash, now);
        revoked += 1;
      }
    }
  }
  return { revoked };
}

