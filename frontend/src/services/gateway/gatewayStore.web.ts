import type { StoredGateway } from './gatewayStore.types';

export type { StoredGateway } from './gatewayStore.types';

/**
 * Web has no secure store, so the web build keeps paired gateways for the tab
 * only (sessionStorage), like the EMS session: closing the tab forgets them.
 * Note a browser page served over HTTPS cannot call a gateway on plain HTTP;
 * on the web only a relay (HTTPS) address works.
 */
const KEY = 'cubegw.gateways';

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

function readAll(): StoredGateway[] {
  try {
    const raw = storage()?.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(parsed) ? (parsed as StoredGateway[]) : [];
  } catch {
    return [];
  }
}

function writeAll(gateways: StoredGateway[]) {
  try {
    storage()?.setItem(KEY, JSON.stringify(gateways));
  } catch {
    // Private mode: kept until reload.
  }
}

export const gatewayStore = {
  load: async () => readAll(),
  save: async (gateway: StoredGateway) => writeAll([...readAll().filter((entry) => entry.id !== gateway.id), gateway]),
  remove: async (id: string) => writeAll(readAll().filter((entry) => entry.id !== id)),
};
