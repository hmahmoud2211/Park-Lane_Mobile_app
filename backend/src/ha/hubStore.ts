import { randomUUID } from 'node:crypto';

import { seal, unseal } from '../ems/secrets.ts';
import { ApiError } from '../errors.ts';
import {
  findHubRow,
  insertHub,
  listHubs as listHubRows,
  toHub,
  updateHub,
  type Hub,
  type HubColumn,
  type HubKind,
  type HubRow,
} from '../repositories/hubs.ts';
import type { HubStatus } from './types.ts';

/**
 * Each unit's hub as stored: its row in the hubs table, with the token and admin
 * password sealed at rest. The live connection is hubRuntime.ts; hubs.ts keeps
 * the running ones.
 */

export type { Hub, HubKind };

export function getHubForUnit(unitId: string): Hub | null {
  const row = findHubRow('unit_id', unitId);
  return row ? toHub(row) : null;
}

/** The hub's address and token, for the REST calls the WebSocket API has no command for. */
export function hubCredentials(id: string): { baseUrl: string; token: string } {
  const row = findHubRow('id', id);
  if (!row?.base_url || !row.token_sealed) {
    throw new ApiError('provisioning', 'Your smart home is still being set up. Try again in a few minutes.');
  }
  return { baseUrl: row.base_url, token: unseal(row.token_sealed) };
}

/** Whether the backend holds a token for the hub (provisioning finished onboarding). */
export function hubHasToken(id: string): boolean {
  return Boolean(findHubRow('id', id)?.token_sealed);
}

export function listHubs(): Hub[] {
  return listHubRows();
}

/** A hub row in `provisioning`, before it has an address or a token. */
export function createHubRow(unitId: string, kind: HubKind, containerName: string | null): Hub {
  const id = randomUUID();
  insertHub(id, unitId, kind, containerName, new Date().toISOString());
  return toHub(findHubRow('id', id) as HubRow);
}

export function updateHubRow(
  id: string,
  changes: Partial<{ baseUrl: string; token: string; adminPassword: string; status: HubStatus; haVersion: string | null; lastError: string | null; seen: boolean }>,
): void {
  const updatedAt = new Date().toISOString();
  const columns: [HubColumn, string | null][] = [];
  if (changes.baseUrl !== undefined) columns.push(['base_url', changes.baseUrl]);
  if (changes.token !== undefined) columns.push(['token_sealed', seal(changes.token)]);
  if (changes.adminPassword !== undefined) columns.push(['admin_password_sealed', seal(changes.adminPassword)]);
  if (changes.status !== undefined) columns.push(['status', changes.status]);
  if (changes.haVersion !== undefined) columns.push(['ha_version', changes.haVersion]);
  if (changes.lastError !== undefined) columns.push(['last_error', changes.lastError]);
  if (changes.seen) columns.push(['last_seen', new Date().toISOString()]);
  updateHub(id, columns, updatedAt);
}
