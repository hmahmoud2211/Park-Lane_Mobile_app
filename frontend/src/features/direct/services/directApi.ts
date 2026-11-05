import { call } from '../../ems/services/emsHttp';
import type { Command, Device, DirectKind, DirectPairing, DirectPairingStatus } from '../../../types/home.types';

/**
 * Direct mode, through the EMS backend (server/src/direct): devices that
 * connect to the backend themselves, with no hub. Same Device shape and
 * commands as the hub's (homeApi.ts), in a list of their own.
 */

/** A direct device answers at once; this leaves room for a slow mobile network. */
const COMMAND_TIMEOUT_MS = 12_000;

export const listDevices = () => call<Device[]>('/api/direct/devices');

export const getDevice = (id: string) => call<Device>(`/api/direct/devices/${encodeURIComponent(id)}`);

export const sendCommand = (id: string, command: Command) =>
  call<Device>(`/api/direct/devices/${encodeURIComponent(id)}/commands`, {
    method: 'POST',
    body: command,
    timeoutMs: COMMAND_TIMEOUT_MS,
  });

export const updateDevice = (id: string, changes: { name: string }) =>
  call<Device>(`/api/direct/devices/${encodeURIComponent(id)}`, { method: 'PATCH', body: changes });

export const removeDevice = (id: string) =>
  call<{ removed: true }>(`/api/direct/devices/${encodeURIComponent(id)}`, { method: 'DELETE' });

export const createPairing = (name: string, kind: DirectKind) =>
  call<DirectPairing>('/api/direct/pairings', { method: 'POST', body: { name, kind } });

export const getPairing = (deviceId: string) => call<DirectPairingStatus>(`/api/direct/pairings/${encodeURIComponent(deviceId)}`);
