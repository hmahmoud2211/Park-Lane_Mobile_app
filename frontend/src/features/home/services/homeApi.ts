import type { HomeAutomation, HomeScene } from '../../../../../shared/contracts/home';
import { call } from '../../ems/services/emsHttp';
import type { Command, Device, FlowStep, Home, Integration, LinkedAccount, Room } from '../../../types/home.types';

/**
 * The resident's home, through the EMS backend (backend/src/ha). The app never
 * talks to Home Assistant: the backend runs each command against the unit's
 * hub and answers with the device as the hub then reports it.
 */

/** A command waits for the device to report back, which a cloud device can take a few seconds to do. */
const COMMAND_TIMEOUT_MS = 20_000;

export const getHome = () => call<Home>('/api/home', { retry: true });

export const listDevices = () => call<Device[]>('/api/devices', { retry: true });

export const getDevice = (id: string) => call<Device>(`/api/devices/${encodeURIComponent(id)}`, { retry: true });

export const sendCommand = (id: string, command: Command) =>
  call<Device>(`/api/devices/${encodeURIComponent(id)}/commands`, {
    method: 'POST',
    body: command,
    timeoutMs: COMMAND_TIMEOUT_MS,
  });

export type DeviceChanges = { name?: string; roomId?: string | null };

export const updateDevice = (id: string, changes: DeviceChanges) =>
  call<Device>(`/api/devices/${encodeURIComponent(id)}`, { method: 'PATCH', body: changes });

export const listRooms = () => call<Room[]>('/api/rooms', { retry: true });

export const createRoom = (name: string) => call<Room>('/api/rooms', { method: 'POST', body: { name } });

// ---- Linking brand accounts ------------------------------------------------------------------

/** Brands sign in against their own clouds, which can take a while (the backend allows 60 s). */
const FLOW_TIMEOUT_MS = 70_000;

export const listIntegrations = () => call<Integration[]>('/api/accounts/integrations', { retry: true });

export const listAccounts = () => call<LinkedAccount[]>('/api/accounts', { retry: true });

export const startFlow = (integration: string) =>
  call<FlowStep>('/api/accounts/flows', { method: 'POST', body: { integration }, timeoutMs: FLOW_TIMEOUT_MS });

export const getFlow = (flowId: string) => call<FlowStep>(`/api/accounts/flows/${encodeURIComponent(flowId)}`, { timeoutMs: FLOW_TIMEOUT_MS });

export const stepFlow = (flowId: string, data: Record<string, unknown>) =>
  call<FlowStep>(`/api/accounts/flows/${encodeURIComponent(flowId)}`, { method: 'POST', body: { data }, timeoutMs: FLOW_TIMEOUT_MS });

export const cancelFlow = (flowId: string) =>
  call<{ cancelled: true }>(`/api/accounts/flows/${encodeURIComponent(flowId)}`, { method: 'DELETE' });

/** The brand's "sign in again" step, or null when reloading the account was enough. */
export const reconnectAccount = (id: string) =>
  call<{ step: FlowStep | null }>(`/api/accounts/${encodeURIComponent(id)}/reconnect`, { method: 'POST', timeoutMs: FLOW_TIMEOUT_MS });

export const removeAccount = (id: string) => call<{ removed: true }>(`/api/accounts/${encodeURIComponent(id)}`, { method: 'DELETE' });

/** Reloads every linked account, so devices added in the brands' own apps come in; lists the ones that failed. */
export const refreshAccounts = () =>
  call<{ refreshed: number; failed: { id: string; brand: string; message: string }[] }>('/api/accounts/refresh', {
    method: 'POST',
    timeoutMs: FLOW_TIMEOUT_MS,
  });

/** Scenes and automations the installer made in the apartment's Home Assistant. */
export const listScenes = () => call<HomeScene[]>('/api/home/scenes', { retry: true });
export const activateScene = (id: string) => call<{ activated: true }>(`/api/home/scenes/${encodeURIComponent(id)}/activate`, { method: 'POST' });
export const listAutomations = () => call<HomeAutomation[]>('/api/home/automations', { retry: true });
export const setAutomation = (id: string, action: 'enable' | 'disable' | 'run') =>
  call<HomeAutomation | null>(`/api/home/automations/${encodeURIComponent(id)}`, { method: 'PATCH', body: { action } });

/** The compound's weather (MET Norway via the backend), or null while it is off on the server. */
export const getWeather = () => call<WeatherNow | null>('/api/weather', { retry: true });

export interface WeatherNow {
  temperatureC: number;
  symbol: string | null;
  updatedAt: string;
  credit: string;
}
