import type { GatewayPass } from '../../../../../shared/contracts/gateway';
import { gatewayConfig } from '../../../config/gateway';
import { call, EmsError, emsErrorText } from '../../ems/services/emsHttp';
import { accountGatewayFrom, nextAccountStep } from './accountAccess';
import * as api from './gatewayApi';
import { GatewayError, gatewayErrorText } from './gatewayHttp';
import type { StoredGateway } from './gatewayStore.types';

/**
 * Connecting this phone to the resident's apartment gateway through their EMS account: a pass
 * from the backend (with the session the EMS calls already share), handed to the gateway for
 * this phone's own token. The rules are in accountAccess.ts.
 */

/** 404 `no_gateway` when the resident has no unit, or the unit has no gateway yet. */
export const requestGatewayPass = () => call<GatewayPass>('/api/gateway/pass', { method: 'POST' });

export type AccountLoginOutcome =
  | { kind: 'connected'; gateway: StoredGateway }
  | { kind: 'already_paired'; gatewayId: string }
  | { kind: 'no_gateway' };

export async function loginWithAccount(clientName: string, gateways: readonly StoredGateway[]): Promise<AccountLoginOutcome> {
  let pass: GatewayPass;
  try {
    pass = await requestGatewayPass();
  } catch (error) {
    if (error instanceof EmsError && error.code === 'no_gateway') {
      return { kind: 'no_gateway' };
    }
    throw error;
  }
  const step = nextAccountStep(pass, gateways);
  if (step.kind !== 'exchange') {
    return step;
  }
  const result = await api.accountLogin(step.url, pass.pass, clientName);
  const gateway = accountGatewayFrom(pass, result, Date.now());
  if (!gateway) {
    // Not the gateway the backend named, so its address can't skip the identity check; the token it issued is dropped.
    void revokeOwnAccess({ lastUrl: step.url, token: result.token });
    throw new GatewayError('unverified_gateway', 'A different gateway answered at your apartment gateway’s address.', 'Try again later, or ask building management.');
  }
  return { kind: 'connected', gateway };
}

/** Ends this phone's own access to a gateway, best effort: a gateway out of reach must not hold up signing out. */
export async function revokeOwnAccess(gateway: Pick<StoredGateway, 'lastUrl' | 'token'>): Promise<void> {
  // Only the address that last proved to be this gateway gets the token.
  if (!gateway.lastUrl) {
    return;
  }
  await api.revokeMe({ baseUrl: gateway.lastUrl, token: gateway.token }, gatewayConfig.revokeTimeoutMs).then(
    () => undefined,
    () => undefined,
  );
}

/** A failed account connection as the screen shows it: the code to word known cases, and the server's own message. */
export function accountErrorOf(error: unknown): { code: string; message: string } {
  if (error instanceof EmsError) {
    return { code: error.code, message: emsErrorText(error) };
  }
  if (error instanceof GatewayError) {
    return { code: error.code, message: gatewayErrorText(error) };
  }
  return { code: 'internal', message: gatewayErrorText(error) };
}
