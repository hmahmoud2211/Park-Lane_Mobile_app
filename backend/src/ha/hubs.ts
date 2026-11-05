import { unseal } from '../ems/secrets.ts';
import { ApiError } from '../errors.ts';
import { findHubRow, toHub } from '../repositories/hubs.ts';
import { HubRuntime } from './hubRuntime.ts';
import { getHubForUnit, listHubs } from './hubStore.ts';
import { unitForUser } from './units.ts';
import type { HubStatus } from './types.ts';

/**
 * Each unit's Home Assistant hub: stored in hubStore.ts, connected by a
 * HubRuntime (hubRuntime.ts) while the backend runs. This module keeps the
 * running ones, one per hub in this process, and re-exports the rest, so
 * callers import hubs from one place.
 */

export {
  createHubRow,
  getHubForUnit,
  hubCredentials,
  hubHasToken,
  listHubs,
  updateHubRow,
  type Hub,
  type HubKind,
} from './hubStore.ts';
export { HubRuntime };

// ---- Registry of running hubs -------------------------------------------------------------

const runtimes = new Map<string, HubRuntime>();

/** Connects to a hub that has an address and a token, replacing any earlier connection. */
export function startHub(hubId: string): HubRuntime | null {
  runtimes.get(hubId)?.stop();
  runtimes.delete(hubId);
  const row = findHubRow('id', hubId);
  if (!row?.base_url || !row.token_sealed) {
    return null;
  }
  const runtime = new HubRuntime(toHub(row), unseal(row.token_sealed));
  runtimes.set(hubId, runtime);
  runtime.start();
  return runtime;
}

export function stopHub(hubId: string): void {
  runtimes.get(hubId)?.stop();
  runtimes.delete(hubId);
}

/** At boot: connect to every hub that finished provisioning. */
export function startHubs(): void {
  for (const hub of listHubs()) {
    if (hub.status !== 'provisioning' && hub.status !== 'failed') {
      startHub(hub.id);
    }
  }
}

export function stopHubs(): void {
  for (const id of [...runtimes.keys()]) {
    stopHub(id);
  }
}

export function runtimeStatus(hubId: string): HubStatus | null {
  return runtimes.get(hubId)?.status ?? null;
}

/** The running hub for a resident's unit, or the reason there is none. */
export function runtimeForUser(userId: string): HubRuntime {
  const unit = unitForUser(userId);
  const hub = getHubForUnit(unit.id);
  if (!hub || hub.status === 'provisioning') {
    throw new ApiError('provisioning', 'Your smart home is still being set up. Try again in a few minutes.');
  }
  const runtime = runtimes.get(hub.id);
  if (!runtime) {
    throw new ApiError('hub_offline', 'Your home hub is not available right now.');
  }
  return runtime;
}
