import { sonoffConfig } from '../../../constants/sonoffConfig';
import type { ApPayloadFormat, ApProvisioningOutcome } from '../../../types/sonoff.types';

/**
 * EXPERIMENTAL: sends home Wi-Fi settings to a plug on its setup hotspot with
 * `POST http://10.10.7.1/ap`. ITEAD does not document this endpoint, and it
 * is NOT verified on the S26R2TPF: there, an empty POST /ap timed out. Two
 * community sources describe its body:
 *
 * - `ewelinkApp`: `{ ssid, password, serverName, port }`, captured from the
 *   official app on firmware 3.5.0 (itead/Sonoff_Devices_DIY_Tools#120).
 * - `sonotaV4`: the same with `version: 4`, from SonOTA (older firmware).
 *
 * `serverName` and `port` say where the plug goes once it is on Wi-Fi: it
 * makes an HTTPS request to `/dispatch/device` there, to be told which
 * server to keep its connection with. The resident picks them; nothing here
 * chooses a server, and nothing else in the app calls this.
 *
 * The outcome is reported as observed. Even `accepted` only means the plug
 * took the settings, not that it joined the network: the flow checks that
 * separately by finding it on the LAN.
 */

export interface ApProvisioningRequest {
  ssid: string;
  /** Sent only to the plug, once. Never stored or logged. */
  password: string;
  serverName: string;
  port: number;
  format: ApPayloadFormat;
  /** The resident has seen what will be sent and confirmed it. */
  confirmed: true;
}

function bodyFor({ ssid, password, serverName, port, format }: ApProvisioningRequest) {
  const fields = { ssid, password, serverName, port };
  return JSON.stringify(format === 'sonotaV4' ? { version: 4, ...fields } : fields);
}

export async function sendWifiCredentialsExperimental(
  request: ApProvisioningRequest,
): Promise<ApProvisioningOutcome> {
  if (request.confirmed !== true) {
    throw new Error('Experimental provisioning needs the resident’s confirmation.');
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, sonoffConfig.provisionTimeoutMs);

  try {
    const response = await fetch(`${sonoffConfig.apBaseUrl}/ap`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: bodyFor(request),
      signal: controller.signal,
    });
    const body = (await response.json().catch(() => undefined)) as { error?: unknown } | undefined;
    if (timedOut) {
      return { kind: 'noResponse' };
    }
    const code = typeof body?.error === 'number' ? body.error : undefined;
    if (response.ok && code === 0) {
      return { kind: 'accepted' };
    }
    return { kind: 'rejected', status: response.status, code };
  } catch {
    // A plug that drops its hotspot while answering looks the same as one
    // that never answered, so neither counts as success or failure.
    return timedOut ? { kind: 'noResponse' } : { kind: 'unreachable' };
  } finally {
    clearTimeout(timer);
  }
}
