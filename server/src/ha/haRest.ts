import { config } from '../config.ts';
import { ApiError } from '../errors.ts';
import { hubCredentials } from './hubs.ts';

/**
 * Home Assistant's REST API, for what its WebSocket API has no command for:
 * config flows (linking accounts) and removing config entries.
 *
 * Every call carries HA-Frontend-Base set to this backend's public address,
 * so integrations that sign in through a browser build their OAuth redirect
 * as PUBLIC_URL/api/accounts/oauth/auth/external/callback, one fixed address
 * for every unit, which the backend routes to the right hub (accounts.ts).
 */

export const OAUTH_BASE_PATH = '/api/accounts/oauth';
/** Generous: a flow step waits on the brand's cloud, which can take a while to sign in. */
const TIMEOUT_MS = 60_000;

export interface RestResult {
  status: number;
  body: unknown;
}

export async function haRest(hubId: string, method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<RestResult> {
  const { baseUrl, token } = hubCredentials(hubId);
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(config.publicUrl ? { 'HA-Frontend-Base': `${config.publicUrl}${OAUTH_BASE_PATH}` } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new ApiError('hub_offline', 'Your home hub is not reachable right now. Try again in a moment.');
  }
  if (response.status === 401) {
    throw new ApiError('hub_auth', 'Your home hub refused the backend. Building management has been told.');
  }
  const text = await response.text();
  let parsed: unknown = text;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // Some errors are plain text, e.g. "Failed dependencies …".
  }
  return { status: response.status, body: parsed };
}

/** The message of a failed call, for the resident. */
export function restMessage(result: RestResult, fallback: string): string {
  if (typeof result.body === 'string' && result.body) {
    return result.body;
  }
  const message = (result.body as { message?: unknown } | null)?.message;
  return typeof message === 'string' && message ? message : fallback;
}
