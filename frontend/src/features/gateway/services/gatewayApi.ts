import { gatewayConfig } from '../../../config/gateway';
import type {
  AdapterInfo,
  Brand,
  Candidate,
  ClaimResult,
  CommandResponse,
  DiscoveryJob,
  GatewayClient,
  GatewayCommand,
  GatewayDevice,
  GatewayHealth,
  GatewayRoom,
  Pairing,
  ProvisioningEventName,
  ProvisioningPlugin,
  ProvisioningSession,
  RemoteStatus,
} from '../../../types/gateway.types';
import { gatewayCall, type GatewayTarget } from './gatewayHttp';

/** Every route in gateway/API.md, one function each. */

const id = (value: string) => encodeURIComponent(value);

// ---- gateway, ownership and access ----------------------------------------------------------

export const getHealth = (baseUrl: string, timeoutMs: number = gatewayConfig.healthTimeoutMs, signal?: AbortSignal) =>
  gatewayCall<GatewayHealth>({ baseUrl }, '/health', { timeoutMs, signal });

export const challenge = (baseUrl: string, clientId: string, nonce: string) =>
  gatewayCall<{ gateway_id: string; proof: string }>({ baseUrl }, '/identity/challenge', {
    method: 'POST',
    body: { client_id: clientId, nonce },
    timeoutMs: gatewayConfig.healthTimeoutMs * 2,
  });

export const claim = (baseUrl: string, setupCode: string, clientName: string) =>
  gatewayCall<ClaimResult>({ baseUrl }, '/auth/claim', { method: 'POST', body: { setup_code: setupCode, client_name: clientName } });

export const join = (baseUrl: string, inviteCode: string, clientName: string) =>
  gatewayCall<ClaimResult>({ baseUrl }, '/auth/join', { method: 'POST', body: { invite_code: inviteCode, client_name: clientName } });

/** Trades a pass from the EMS backend (accountLogin.ts) for this phone's own token, answered like join. */
export const accountLogin = (baseUrl: string, pass: string, clientName: string) =>
  gatewayCall<ClaimResult>({ baseUrl }, '/auth/account', { method: 'POST', body: { pass, client_name: clientName } });

export const getMe = (t: GatewayTarget) => gatewayCall<{ client: GatewayClient; gateway: { id: string; name: string } }>(t, '/auth/me');

/** Ends this phone's own access: its token stops working on the gateway. */
export const revokeMe = (t: GatewayTarget, timeoutMs?: number) =>
  gatewayCall<{ revoked: string }>(t, '/auth/me', { method: 'DELETE', timeoutMs });

export const createInvite = (t: GatewayTarget, role: 'member' | 'owner') =>
  gatewayCall<{ code: string; expires_at: number }>(t, '/auth/invites', { method: 'POST', body: { role } });

export const listClients = (t: GatewayTarget) => gatewayCall<GatewayClient[]>(t, '/auth/clients');

export const revokeClient = (t: GatewayTarget, clientId: string) =>
  gatewayCall<unknown>(t, `/auth/clients/${id(clientId)}`, { method: 'DELETE' });

export const renameGateway = (t: GatewayTarget, name: string) =>
  gatewayCall<{ id: string; name: string }>(t, '/gateway', { method: 'PATCH', body: { name } });

// ---- catalog --------------------------------------------------------------------------------

export const listBrands = (t: GatewayTarget) => gatewayCall<Brand[]>(t, '/brands');

export const listAdapters = (t: GatewayTarget) => gatewayCall<AdapterInfo[]>(t, '/adapters');

export const listProvisioningPlugins = (t: GatewayTarget) => gatewayCall<ProvisioningPlugin[]>(t, '/provisioning/plugins');

// ---- discovery ------------------------------------------------------------------------------

export interface DiscoveryOptions {
  brand_id?: string;
  adapter_ids?: string[];
  timeout?: number;
  subnet_scan?: boolean;
}

export const startDiscovery = (t: GatewayTarget, options: DiscoveryOptions) =>
  gatewayCall<DiscoveryJob>(t, '/discovery/jobs', { method: 'POST', body: options });

export const getDiscovery = (t: GatewayTarget, jobId: string) => gatewayCall<DiscoveryJob>(t, `/discovery/jobs/${id(jobId)}`);

export const cancelDiscovery = (t: GatewayTarget, jobId: string) =>
  gatewayCall<DiscoveryJob>(t, `/discovery/jobs/${id(jobId)}`, { method: 'DELETE' });

export function listCandidates(t: GatewayTarget, filter: { job_id?: string; brand_id?: string; adapter_id?: string } = {}) {
  const query = Object.entries(filter)
    .filter(([, value]) => Boolean(value))
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`)
    .join('&');
  return gatewayCall<Candidate[]>(t, `/discovery/candidates${query ? `?${query}` : ''}`);
}

export const probeHost = (t: GatewayTarget, host: string, adapterId?: string) =>
  gatewayCall<Candidate>(t, '/discovery/probe', { method: 'POST', body: { host, adapter_id: adapterId }, timeoutMs: 15_000 });

// ---- pairing --------------------------------------------------------------------------------

export const startPairing = (
  t: GatewayTarget,
  request: { candidate_id: string; credentials?: Record<string, string>; name?: string; room_id?: string | null },
) => gatewayCall<Pairing>(t, '/pairings', { method: 'POST', body: request, timeoutMs: gatewayConfig.pairingTimeoutMs });

export const getPairing = (t: GatewayTarget, pairingId: string) => gatewayCall<Pairing>(t, `/pairings/${id(pairingId)}`);

// ---- provisioning ---------------------------------------------------------------------------

export const startProvisioning = (t: GatewayTarget, pluginId: string, model?: string | null) =>
  gatewayCall<ProvisioningSession>(t, '/provisioning/sessions', { method: 'POST', body: { plugin_id: pluginId, model: model ?? undefined } });

export const getProvisioning = (t: GatewayTarget, sessionId: string) =>
  gatewayCall<ProvisioningSession>(t, `/provisioning/sessions/${id(sessionId)}`);

export const reportProvisioning = (t: GatewayTarget, sessionId: string, event: ProvisioningEventName, data: Record<string, unknown> = {}) =>
  gatewayCall<ProvisioningSession>(t, `/provisioning/sessions/${id(sessionId)}/events`, { method: 'POST', body: { event, data } });

/** Gateway transport only: the gateway joins the hotspot itself. The passwords are sent once, never stored here. */
export const runProvisioning = (
  t: GatewayTarget,
  sessionId: string,
  request: { home_ssid: string; home_password: string; hotspot_ssid: string; hotspot_password?: string | null },
) => gatewayCall<ProvisioningSession>(t, `/provisioning/sessions/${id(sessionId)}/run`, { method: 'POST', body: request, timeoutMs: 30_000 });

export const cancelProvisioning = (t: GatewayTarget, sessionId: string) =>
  gatewayCall<ProvisioningSession>(t, `/provisioning/sessions/${id(sessionId)}`, { method: 'DELETE' });

// ---- devices and rooms ----------------------------------------------------------------------

export const listDevices = (t: GatewayTarget) => gatewayCall<GatewayDevice[]>(t, '/devices');

export const getDevice = (t: GatewayTarget, deviceId: string) => gatewayCall<GatewayDevice>(t, `/devices/${id(deviceId)}`);

export const updateDevice = (t: GatewayTarget, deviceId: string, changes: { name?: string; room_id?: string | null; dashboard?: boolean }) =>
  gatewayCall<GatewayDevice>(t, `/devices/${id(deviceId)}`, { method: 'PATCH', body: changes });

export const removeDevice = (t: GatewayTarget, deviceId: string) => gatewayCall<unknown>(t, `/devices/${id(deviceId)}`, { method: 'DELETE' });

export const sendCommand = (t: GatewayTarget, deviceId: string, command: GatewayCommand) =>
  gatewayCall<CommandResponse>(t, `/devices/${id(deviceId)}/commands`, {
    method: 'POST',
    body: command,
    timeoutMs: gatewayConfig.commandTimeoutMs,
  });

export const refreshDevice = (t: GatewayTarget, deviceId: string) =>
  gatewayCall<GatewayDevice>(t, `/devices/${id(deviceId)}/refresh`, { method: 'POST', timeoutMs: gatewayConfig.commandTimeoutMs });

export const listRooms = (t: GatewayTarget) => gatewayCall<GatewayRoom[]>(t, '/rooms');

export const createRoom = (t: GatewayTarget, name: string) => gatewayCall<GatewayRoom>(t, '/rooms', { method: 'POST', body: { name } });

export const renameRoom = (t: GatewayTarget, roomId: string, name: string) =>
  gatewayCall<GatewayRoom>(t, `/rooms/${id(roomId)}`, { method: 'PATCH', body: { name } });

export const deleteRoom = (t: GatewayTarget, roomId: string) => gatewayCall<unknown>(t, `/rooms/${id(roomId)}`, { method: 'DELETE' });

// ---- remote access --------------------------------------------------------------------------

export const getRemote = (t: GatewayTarget) => gatewayCall<RemoteStatus>(t, '/remote');

export const enableRelay = (t: GatewayTarget, url: string, enrollToken?: string) =>
  gatewayCall<RemoteStatus>(t, '/remote/relay', { method: 'PUT', body: { url, enroll_token: enrollToken || undefined }, timeoutMs: 20_000 });

export const disableRelay = (t: GatewayTarget) => gatewayCall<RemoteStatus>(t, '/remote/relay', { method: 'DELETE' });
