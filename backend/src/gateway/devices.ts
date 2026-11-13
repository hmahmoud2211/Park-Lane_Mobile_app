import { ApiError } from '../errors.ts';
import { deviceCallToken } from '../ems/gatewayAccess.ts';
import type { CommandSource } from '../ha/commands.ts';
import { runtimeForUser } from '../ha/hubs.ts';
import type { CommandRequest, Device } from '../ha/types.ts';
import { log } from '../log.ts';
import { recordAudit } from '../repositories/audit.ts';
import { findGatewayOfUnit, type Gateway } from '../repositories/gateways.ts';
import { findUnitOfUser } from '../repositories/units.ts';
import { GATEWAY_ID_PREFIX, toDevice, toGatewayCommand, type GatewayDevice } from './mapping.ts';

/**
 * The unit's CUBE gateway devices for the Parklane Assistant.
 *
 * The assistant runs on a server and reads the home through this backend (GET /api/devices with an assistant
 * token), which until now meant Home Assistant only. Devices on the apartment's CUBE gateway, such as an LG TV on the
 * home Wi-Fi, are reached here instead: through the gateway's relay address, one signed request at a time
 * (ems/gatewayAccess.ts deviceCallToken), never with a stored secret. The app's own session doesn't come here: the
 * app talks to its gateway itself.
 *
 * Commands go through mapping.ts's allowlist and every one is audited, like the assistant's Home Assistant commands.
 * A gateway that doesn't answer leaves its devices in the list as last seen, marked offline, so the assistant can say
 * so instead of acting as if they didn't exist.
 */

const LIST_TIMEOUT_MS = 6_000;
/** The gateway waits up to ten seconds for a busy device, and longer for a TV to come back on. */
const COMMAND_TIMEOUT_MS = 25_000;
const DEVICE_ID = /^[A-Za-z0-9_-]{1,64}$/;

/** Each gateway's devices as last read, shown offline while it doesn't answer. */
const lastSeen = new Map<string, Device[]>();

export const isGatewayDeviceId = (id: string) => id.startsWith(GATEWAY_ID_PREFIX);

function gatewayOf(userId: string): Gateway | null {
  const unit = findUnitOfUser(userId);
  return unit ? findGatewayOfUnit(unit.id) : null;
}

const offline = () => new ApiError('gateway_offline', 'Your home gateway is not reachable right now. Try again in a moment.');

/** One request to the gateway through its relay address, as the resident; the gateway's answer or an ApiError. */
async function call<T>(gateway: Gateway, userId: string, method: 'GET' | 'POST', path: string, body: unknown, timeoutMs: number): Promise<T> {
  if (!gateway.url) {
    throw new ApiError('gateway_offline', 'Your home gateway has no remote address yet, so only the app at home can reach it.');
  }
  let response: Response;
  try {
    response = await fetch(`${gateway.url}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${deviceCallToken(userId, gateway.id, method, path)}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    throw offline();
  }
  const envelope = (await response.json().catch(() => null)) as { ok?: boolean; data?: T; error?: { code?: string; message?: string } } | null;
  if (response.ok && envelope?.ok) {
    return envelope.data as T;
  }
  const code = envelope?.error?.code ?? '';
  const message = envelope?.error?.message;
  if (response.status === 401 || response.status === 403 || code === 'account_login_off') {
    log.warn('A unit gateway refused the backend', { gateway: gateway.id, status: response.status, code });
    throw new ApiError('gateway_rejected', 'Your home gateway refused the request. Building management has been told.');
  }
  if (response.status === 404 && code === 'not_found') {
    throw new ApiError('not_found', 'That device is no longer on your home gateway.');
  }
  if (response.status === 409) {
    throw new ApiError('conflict', message ?? 'This device is still busy with the last command.');
  }
  if (response.status === 400 || response.status === 422) {
    throw new ApiError('not_available', message ?? 'This device cannot do that.');
  }
  if (response.status >= 500 || !envelope) {
    throw offline();
  }
  throw new ApiError('gateway_rejected', message ?? 'Your home gateway could not do that.');
}

/** The unit's gateway devices, or null when the unit has no gateway. Offline (as last seen) when it doesn't answer. */
export async function gatewayDevicesFor(userId: string): Promise<Device[] | null> {
  const gateway = gatewayOf(userId);
  if (!gateway) {
    return null;
  }
  try {
    const devices = (await call<GatewayDevice[]>(gateway, userId, 'GET', '/api/v1/devices', undefined, LIST_TIMEOUT_MS)).map(toDevice);
    lastSeen.set(gateway.id, devices);
    return devices;
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    log.warn('Reading a unit gateway\'s devices failed', { gateway: gateway.id, reason: error.message });
    return (lastSeen.get(gateway.id) ?? []).map((device) => ({ ...device, online: false, lastError: error.message }));
  }
}

/** GET /api/devices for an assistant: Home Assistant's devices and the gateway's, either one alone when the other is missing. */
export async function assistantDevices(userId: string): Promise<Device[]> {
  let fromHub: Device[] = [];
  let hubError: unknown = null;
  try {
    fromHub = runtimeForUser(userId).listDevices();
  } catch (error) {
    hubError = error;
  }
  const fromGateway = await gatewayDevicesFor(userId);
  if (fromGateway === null) {
    if (hubError) throw hubError;
    return fromHub;
  }
  return [...fromHub, ...fromGateway];
}

function rawId(id: string): string {
  const raw = id.slice(GATEWAY_ID_PREFIX.length);
  if (!DEVICE_ID.test(raw)) {
    throw new ApiError('not_found', 'No such device.');
  }
  return raw;
}

function requireGateway(userId: string): Gateway {
  const gateway = gatewayOf(userId);
  if (!gateway) {
    throw new ApiError('not_found', 'No such device.');
  }
  return gateway;
}

export async function gatewayDevice(userId: string, id: string): Promise<Device> {
  const gateway = requireGateway(userId);
  return toDevice(await call<GatewayDevice>(gateway, userId, 'GET', `/api/v1/devices/${rawId(id)}`, undefined, LIST_TIMEOUT_MS));
}

/** Runs one allowlisted command on a gateway device and answers with the device as the gateway then reports it. */
export async function commandGatewayDevice(userId: string, id: string, request: CommandRequest, source: CommandSource): Promise<Device> {
  const gateway = requireGateway(userId);
  const deviceId = rawId(id);
  const raw = await call<GatewayDevice>(gateway, userId, 'GET', `/api/v1/devices/${deviceId}`, undefined, LIST_TIMEOUT_MS);
  const command = toGatewayCommand(raw, request);
  recordAudit({
    userId,
    hubId: `gw:${gateway.id}`,
    action: `gateway.${command.command}`,
    target: deviceId,
    via: source === 'app' ? null : source,
    at: new Date().toISOString(),
  });
  const answer = await call<{ device: GatewayDevice }>(gateway, userId, 'POST', `/api/v1/devices/${deviceId}/commands`, command, COMMAND_TIMEOUT_MS);
  return toDevice(answer.device);
}
