import type { GatewayPass } from '../../../../../shared/contracts/gateway';
import type { ClaimResult } from '../../../types/gateway.types';
import type { StoredGateway } from './gatewayStore.types';

/**
 * A resident's access to their apartment's gateway through their EMS account, as rules with
 * no React and no network, so they can be checked on their own (accountAccess.checks.ts).
 * accountLogin.ts makes the calls; GatewayContext decides when, with these.
 *
 * The account only replaces the setup or invite code: each phone still gets its own gateway
 * token, so one lost phone can be removed alone. A phone holds that token only while the
 * resident is signed in, so whoever signs in next on it starts without it.
 */

type Entry = Pick<StoredGateway, 'id' | 'source'>;

/** Where the resident's access to the apartment gateway stands, for the gateway screen. */
export type AccountLink =
  | { state: 'idle' }
  | { state: 'connecting' }
  | { state: 'connected'; gatewayId: string }
  | { state: 'no_gateway' }
  | { state: 'error'; code: string; message: string };

export const isAccountIssued = (gateway: Pick<StoredGateway, 'source'>) => gateway.source === 'account';

/** The gateway's address from a pass, without a trailing slash since API paths are appended to it. */
export function passUrl(pass: GatewayPass): string | null {
  const url = (pass.gateway.url ?? '').trim().replace(/\/+$/, '');
  return url || null;
}

export type AccountStep =
  | { kind: 'no_gateway' }
  | { kind: 'already_paired'; gatewayId: string }
  | { kind: 'exchange'; url: string };

/**
 * What to do with a fresh pass. Without an address there is nothing to hand it to, which for
 * the resident is the same as no gateway yet. A phone already paired with that gateway by code
 * keeps that access: the pass is left to expire rather than adding a second token for this phone.
 * An earlier account-issued entry for it is replaced (the gateway refused it, or the resident's
 * role changed).
 */
export function nextAccountStep(pass: GatewayPass, gateways: readonly Entry[]): AccountStep {
  const url = passUrl(pass);
  if (!url) {
    return { kind: 'no_gateway' };
  }
  const paired = gateways.find((entry) => entry.id === pass.gateway.id && !isAccountIssued(entry));
  return paired ? { kind: 'already_paired', gatewayId: paired.id } : { kind: 'exchange', url };
}

/**
 * The gateway to keep after a pass was exchanged, or null when the one that answered is not the
 * gateway the backend named. The address skips the identity challenge (hmac.ts) because the
 * signed-in backend vouched for it and the gateway there just answered with this phone's new
 * credentials; that vouching covers only the gateway id in the pass.
 */
export function accountGatewayFrom(pass: GatewayPass, result: ClaimResult, now: number): StoredGateway | null {
  const url = passUrl(pass);
  if (!url || result.gateway.id !== pass.gateway.id) {
    return null;
  }
  return {
    id: result.gateway.id,
    name: result.gateway.name,
    clientId: result.client.id,
    // The gateway's word, since it is what the token carries; the pass's role is the backend's view of the same.
    role: result.client.role,
    token: result.token,
    pinKey: result.pin_key,
    endpoints: { remote: [url] },
    lastUrl: url,
    verifiedUrls: [url],
    pairedAt: now,
    source: 'account',
  };
}

/**
 * Connect through the account without being asked: only with a session, once the stored
 * gateways are known and there are none, and once per sign-in (or app start) so a failure or
 * "no gateway yet" is not asked again in a loop.
 */
export function shouldConnectOnSignIn(input: { signedIn: boolean; storeLoaded: boolean; gatewayCount: number; triedThisSession: boolean }): boolean {
  return input.signedIn && input.storeLoaded && input.gatewayCount === 0 && !input.triedThisSession;
}

/**
 * A refused account-issued token gets one fresh pass and exchange per gateway and sign-in
 * (the phone was removed, or the resident's role changed and was re-issued); after that the
 * refusal stands. Pairing-issued gateways are never re-issued this way.
 */
export function shouldRetryRefused(input: { gateway: Entry | null; refused: boolean; signedIn: boolean; retried: ReadonlySet<string> }): boolean {
  const { gateway } = input;
  return Boolean(gateway && input.refused && input.signedIn && isAccountIssued(gateway) && !input.retried.has(gateway.id));
}

/** What leaves the phone once signed out: every account-issued gateway, and nothing paired by code. */
export function removedOnSignOut<T extends Entry>(gateways: readonly T[], signedOut: boolean): T[] {
  return signedOut ? gateways.filter(isAccountIssued) : [];
}

/**
 * The link as the screen shows it: connected while the phone holds the gateway it connected to,
 * or any account-issued one (such as one kept from an earlier app start).
 */
export function accountLinkView(link: AccountLink, gateways: readonly Entry[]): AccountLink {
  if (link.state === 'connected' && gateways.some((entry) => entry.id === link.gatewayId)) {
    return link;
  }
  if (link.state === 'connected' || link.state === 'idle') {
    const held = gateways.find(isAccountIssued);
    return held ? { state: 'connected', gatewayId: held.id } : { state: 'idle' };
  }
  return link;
}
