import type { GatewayClient } from '../../../types/gateway.types';

/**
 * The phones that can use a gateway, as an owner sees them to find and remove a lost one
 * (GET /auth/clients). Rules only, no React or network, so they are checked on their own
 * (gatewayPhones.checks.ts); the words are the screen's.
 */

/** Whose phone: connected through this resident's account, another resident's, or paired with a code by an installer. */
export type PhoneOrigin = 'mine' | 'resident' | 'installer';

/** How long ago, in the unit the screen words it in; older than a week, the date itself. */
export type PhoneAge =
  | { unit: 'now' }
  | { unit: 'minutes' | 'hours' | 'days'; count: number }
  | { unit: 'date'; at: number };

export interface PhoneRow {
  id: string;
  name: string;
  role: 'owner' | 'member';
  thisPhone: boolean;
  origin: PhoneOrigin;
  /** Null for a phone that never used its token. */
  lastUsed: PhoneAge | null;
  added: PhoneAge | null;
  /** Every phone but this one: the gateway refuses to remove the phone asking, which signs out instead. */
  removable: boolean;
}

const MINUTE = 60;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

/** `seconds` (a gateway time) relative to `nowMs`. A time ahead of the phone's clock reads as now. */
export function phoneAge(seconds: number, nowMs: number): PhoneAge {
  const ago = nowMs / 1000 - seconds;
  if (ago < MINUTE) return { unit: 'now' };
  if (ago < HOUR) return { unit: 'minutes', count: Math.floor(ago / MINUTE) };
  if (ago < DAY) return { unit: 'hours', count: Math.floor(ago / HOUR) };
  if (ago < WEEK) return { unit: 'days', count: Math.floor(ago / DAY) };
  return { unit: 'date', at: Math.round(seconds * 1000) };
}

export function phoneOrigin(accountId: string | null | undefined, myAccountId: string | null): PhoneOrigin {
  if (!accountId) return 'installer';
  // Without the signed-in user (offline at launch) a phone can't be called this resident's: it is still a resident's.
  return myAccountId !== null && accountId === myAccountId ? 'mine' : 'resident';
}

const seen = (client: GatewayClient) => (typeof client.last_seen === 'number' ? client.last_seen : null);
const createdAt = (client: GatewayClient) => (typeof client.created_at === 'number' ? client.created_at : 0);

/**
 * Most recently used first; phones that never used their token after those, newest added
 * first, since the lost phone is usually one that has gone quiet. Revoked phones are left out.
 */
function byRecentUse(a: GatewayClient, b: GatewayClient): number {
  const lastA = seen(a);
  const lastB = seen(b);
  if (lastA !== null || lastB !== null) {
    if (lastA === null) return 1;
    if (lastB === null) return -1;
    if (lastA !== lastB) return lastB - lastA;
  }
  return createdAt(b) - createdAt(a) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}

export function phoneRows(
  clients: readonly GatewayClient[],
  context: { ownClientId: string; myAccountId: string | null; nowMs: number },
): PhoneRow[] {
  return clients
    .filter((client) => !client.revoked)
    .sort(byRecentUse)
    .map((client) => {
      const thisPhone = client.id === context.ownClientId;
      const last = seen(client);
      return {
        id: client.id,
        name: client.name,
        role: client.role,
        thisPhone,
        origin: phoneOrigin(client.account_id, context.myAccountId),
        lastUsed: last === null ? null : phoneAge(last, context.nowMs),
        added: typeof client.created_at === 'number' ? phoneAge(client.created_at, context.nowMs) : null,
        removable: !thisPhone,
      };
    });
}
