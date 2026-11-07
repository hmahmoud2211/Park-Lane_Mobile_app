import { createContext, useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { AppState, Platform } from 'react-native';

import { gatewayBaseUrl } from '../../../config/gateway';
import { useEms } from '../../ems/hooks/useEms';
import { getSessionToken } from '../../ems/services/emsHttp';
import {
  accountLinkView,
  isAccountIssued,
  removedOnSignOut,
  shouldConnectOnSignIn,
  shouldRetryRefused,
  type AccountLink,
} from '../services/accountAccess';
import { accountErrorOf, loginWithAccount, revokeOwnAccess } from '../services/accountLogin';
import * as api from '../services/gatewayApi';
import { resolveEndpoint } from '../services/gatewayDiscovery';
import { withTlsEndpoints } from '../services/gatewayEndpoints';
import { GatewayError, onTokenRefused, type GatewayTarget } from '../services/gatewayHttp';
import { gatewayStore, type StoredGateway } from '../services/gatewayStore';
import { GatewayRealtime } from '../services/realtime';
import type { RealtimeState } from '../../../types/ems.types';
import type { ClaimResult, GatewayDevice, GatewayEvent, GatewayRoom } from '../../../types/gateway.types';
import { brand } from '../../../config/brand';

/**
 * The resident's CUBE Gateway: the box on their own Wi-Fi that finds, sets
 * up and controls devices locally (gateway/ in this repo). Holds the paired
 * gateways, picks a working address for the active one (home network first,
 * then Tailscale or relay), keeps its devices and rooms live over the event
 * channel, and lets screens listen to discovery, pairing and provisioning
 * events.
 *
 * Moving to a new address (the gateway's IP changed, or the phone left home)
 * only happens after that address proves it is the same gateway (hmac.ts, or
 * a certificate for one of the gateway's own HTTPS names); the token is never
 * sent anywhere unverified.
 *
 * A signed-in resident gets their apartment's gateway through their EMS
 * account (services/accountAccess.ts); that access is taken off the phone
 * again when they sign out. Setup and invite codes stay for installers.
 */

export type GatewayStatus = 'loading' | 'none' | 'connecting' | 'online' | 'offline' | 'unauthorized';

export type { AccountLink } from '../services/accountAccess';

interface GatewayContextValue {
  status: GatewayStatus;
  gateways: StoredGateway[];
  active: StoredGateway | null;
  /** The working address and token, or null while offline. */
  target: GatewayTarget | null;
  role: 'owner' | 'member' | null;
  devices: GatewayDevice[];
  rooms: GatewayRoom[];
  devicesLoaded: boolean;
  realtime: RealtimeState;
  /** Why the gateway is offline or refused, for the status line. */
  problem: string | null;
  /** Pairs with a new gateway as its owner, with the setup code from its logs. */
  claim: (host: string, setupCode: string) => Promise<StoredGateway>;
  /** Joins a gateway with an invite code from its owner. */
  join: (host: string, inviteCode: string) => Promise<StoredGateway>;
  /** Access to the apartment's gateway through the resident's EMS account. */
  account: AccountLink;
  /** Connects this phone to the apartment's gateway through the resident's EMS account. */
  connectAccount: () => Promise<void>;
  select: (id: string) => void;
  /** Removes a gateway from this phone; an account-issued one gives up its token on the gateway first (best effort). */
  forget: (id: string) => Promise<void>;
  /** Sets the addresses tried away from home (Tailscale address, relay URL). */
  setRemoteEndpoints: (id: string, urls: string[]) => Promise<void>;
  /** Re-resolves the address (scanning the home network if needed) and re-reads devices. */
  reconnect: () => Promise<void>;
  refresh: () => Promise<void>;
  upsertDevice: (device: GatewayDevice) => void;
  dropDevice: (id: string) => void;
  /** Every event from the gateway; returns the unsubscribe function. */
  subscribe: (listener: (event: GatewayEvent) => void) => () => void;
}

export const GatewayContext = createContext<GatewayContextValue | undefined>(undefined);

const CLIENT_NAME = `${brand.appName} on ${Platform.OS === 'ios' ? 'iPhone' : Platform.OS === 'android' ? 'Android' : 'the web'}`;

function sortDevices(devices: GatewayDevice[]): GatewayDevice[] {
  return [...devices].sort((a, b) => (a.room ?? '￿').localeCompare(b.room ?? '￿') || a.name.localeCompare(b.name));
}

function storedFrom(result: ClaimResult, baseUrl: string): StoredGateway {
  const remote = baseUrl.startsWith('https://') || /\/relay\//.test(baseUrl) ? [baseUrl] : [];
  return {
    id: result.gateway.id,
    name: result.gateway.name,
    clientId: result.client.id,
    role: result.client.role,
    token: result.token,
    pinKey: result.pin_key,
    endpoints: { lan: remote.length ? undefined : baseUrl, remote },
    lastUrl: baseUrl,
    // Claiming proved this address: it accepted the one-time code.
    verifiedUrls: [baseUrl],
    pairedAt: Date.now(),
    source: 'pairing',
  };
}

function refusedProblem(gateway: Pick<StoredGateway, 'source'> | null): string {
  return gateway && isAccountIssued(gateway)
    ? 'This gateway no longer accepts this phone through your account.'
    : 'This gateway no longer accepts this phone. Pair it again, or ask its owner for an invite.';
}

export function GatewayProvider({ children }: PropsWithChildren) {
  const [gateways, setGateways] = useState<StoredGateway[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [status, setStatus] = useState<GatewayStatus>('loading');
  const [baseUrl, setBaseUrl] = useState<string | null>(null);
  const [devices, setDevices] = useState<GatewayDevice[]>([]);
  const [rooms, setRooms] = useState<GatewayRoom[]>([]);
  const [devicesLoaded, setDevicesLoaded] = useState(false);
  const [realtime, setRealtime] = useState<RealtimeState>('offline');
  const [problem, setProblem] = useState<string | null>(null);
  const listeners = useRef(new Set<(event: GatewayEvent) => void>());
  const channel = useRef<GatewayRealtime | null>(null);
  const resolving = useRef<Promise<void> | null>(null);
  const ems = useEms();
  // A session that must still choose its own password can't ask for a pass (403): account access waits for it.
  const signedIn = ems.status === 'signedIn' && !ems.passwordChangeRequired;
  const signedOut = ems.status === 'signedOut';
  const [accountLink, setAccountLink] = useState<AccountLink>({ state: 'idle' });
  // What one session found must not show in the next: reset whenever the session starts or ends.
  const [linkSignedIn, setLinkSignedIn] = useState(signedIn);
  if (linkSignedIn !== signedIn) {
    setLinkSignedIn(signedIn);
    setAccountLink({ state: 'idle' });
  }
  const accountRun = useRef<{ session: string; run: Promise<void> } | null>(null);
  /** The session the automatic account connection last ran for. */
  const autoConnectedFor = useRef<string | null>(null);
  /** Gateways whose refused account token was already re-issued once this session. */
  const refusalRetried = useRef(new Set<string>());
  /** Account-issued gateways being taken off the phone after sign-out. */
  const dropping = useRef(new Set<string>());

  const active = useMemo(() => gateways.find((gateway) => gateway.id === activeId) ?? null, [gateways, activeId]);
  const target = useMemo<GatewayTarget | null>(
    () => (active && baseUrl && status === 'online' ? { baseUrl, token: active.token } : null),
    [active, baseUrl, status],
  );

  /** Switches gateway: forgets the previous one's address and devices, then resolves the new one. */
  const activate = useCallback((id: string | null) => {
    setBaseUrl(null);
    setDevices([]);
    setRooms([]);
    setDevicesLoaded(false);
    setProblem(null);
    setActiveId(id);
    setStatus(id ? 'connecting' : 'none');
  }, []);

  const persist = useCallback(async (next: StoredGateway) => {
    await gatewayStore.save(next).catch(() => undefined);
    setGateways((current) => [...current.filter((entry) => entry.id !== next.id), next]);
  }, []);

  // Load the paired gateways on launch.
  useEffect(() => {
    let cancelled = false;
    void gatewayStore.load().then((stored) => {
      if (cancelled) return;
      setGateways(stored);
      const first = [...stored].sort((a, b) => a.pairedAt - b.pairedAt)[0];
      setActiveId(first?.id ?? null);
      setStatus(first ? 'connecting' : 'none');
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const upsertDevice = useCallback((device: GatewayDevice) => {
    setDevices((current) => sortDevices([...current.filter((entry) => entry.id !== device.id), device]));
  }, []);

  const dropDevice = useCallback((id: string) => {
    setDevices((current) => current.filter((entry) => entry.id !== id));
  }, []);

  const load = useCallback(async (next: GatewayTarget) => {
    const [list, roomList] = await Promise.all([api.listDevices(next), api.listRooms(next)]);
    setDevices(sortDevices(list));
    setRooms(roomList);
    setDevicesLoaded(true);
  }, []);

  /** Finds a working, verified address for the active gateway and reads its devices. */
  const resolve = useCallback(
    async (gateway: StoredGateway, scan: boolean) => {
      setStatus((current) => (current === 'online' ? current : 'connecting'));
      const endpoint = await resolveEndpoint(gateway, { scan });
      if (!endpoint) {
        setStatus('offline');
        setBaseUrl(null);
        setProblem(
          gateway.endpoints.lan
            ? 'Your gateway did not answer at its home or remote address.'
            : isAccountIssued(gateway)
              ? 'Your gateway did not answer through CUBE’s relay. Check your internet connection and try again.'
              : 'Your gateway on CUBE’s server did not answer. Check your internet connection and try again.',
        );
        setDevicesLoaded(true);
        return;
      }
      const endpoints = withTlsEndpoints(
        endpoint.lanChanged ? { ...gateway.endpoints, lan: endpoint.url } : gateway.endpoints,
        gateway.id,
        endpoint.health,
      );
      const tlsChanged = endpoints.lanTls !== gateway.endpoints.lanTls || endpoints.remoteTls !== gateway.endpoints.remoteTls;
      const updated: StoredGateway = {
        ...gateway,
        lastUrl: endpoint.url,
        verifiedUrls: endpoint.newlyVerified ? [...gateway.verifiedUrls, endpoint.url].slice(-8) : gateway.verifiedUrls,
        endpoints,
      };
      if (updated.lastUrl !== gateway.lastUrl || endpoint.newlyVerified || endpoint.lanChanged || tlsChanged) {
        await persist(updated);
      }
      try {
        await load({ baseUrl: endpoint.url, token: gateway.token });
        setBaseUrl(endpoint.url);
        setStatus('online');
        setProblem(null);
      } catch (error) {
        if (error instanceof GatewayError && error.code === 'unauthorized') {
          setStatus('unauthorized');
          setProblem(refusedProblem(gateway));
        } else {
          setStatus('offline');
          setProblem(error instanceof GatewayError ? error.message : 'Your gateway could not be read.');
        }
        setBaseUrl(null);
        setDevicesLoaded(true);
      }
    },
    [load, persist],
  );

  const resolveRef = useRef(resolve);
  useEffect(() => {
    resolveRef.current = resolve;
  }, [resolve]);

  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  const reconnect = useCallback(async () => {
    const gateway = activeRef.current;
    if (!gateway) {
      return;
    }
    resolving.current ??= resolveRef.current(gateway, true).finally(() => {
      resolving.current = null;
    });
    await resolving.current;
  }, []);

  // Resolve whenever the active gateway changes (activate() has cleared the previous one's state).
  const activeKey = active ? `${active.id}:${active.token}` : null;
  useEffect(() => {
    if (activeKey) {
      void reconnect();
    }
  }, [activeKey, reconnect]);

  // A token refused on any call means the gateway revoked this phone.
  useEffect(
    () =>
      onTokenRefused((refusedUrl) => {
        if (refusedUrl === baseUrl) {
          setStatus('unauthorized');
          setProblem(refusedProblem(activeRef.current));
        }
      }),
    [baseUrl],
  );

  const refresh = useCallback(async () => {
    if (target) {
      try {
        await load(target);
        return;
      } catch {
        // Fall through to a fresh resolve: the address may have changed.
      }
    }
    await reconnect();
  }, [target, load, reconnect]);

  // One event channel while online.
  const token = active?.token ?? null;
  useEffect(() => {
    if (status !== 'online' || !baseUrl || !token) {
      return;
    }
    const onEvent = (event: GatewayEvent) => {
      if (event.type === 'device.updated') {
        upsertDevice(event.data.device);
      } else if (event.type === 'device.removed') {
        dropDevice(event.data.id);
      } else if (event.type === 'rooms.updated') {
        setRooms(event.data.rooms);
      }
      listeners.current.forEach((listener) => listener(event));
    };
    if (channel.current) {
      channel.current.retarget(baseUrl);
      return;
    }
    const next = new GatewayRealtime(baseUrl, token, {
      onEvent,
      onState: setRealtime,
      onRefused: () => {
        setStatus('unauthorized');
        setProblem(refusedProblem(activeRef.current));
      },
    });
    channel.current = next;
    next.start();
    return undefined;
  }, [status, baseUrl, token, upsertDevice, dropDevice]);

  // Stop the channel when going offline, switching gateway or unmounting.
  useEffect(() => {
    if (status === 'online') {
      return;
    }
    channel.current?.stop();
    channel.current = null;
  }, [status]);
  useEffect(
    () => () => {
      channel.current?.stop();
      channel.current = null;
    },
    [activeId],
  );

  // Back in the foreground: wake the channel, or try again if the gateway was unreachable.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      if (channel.current) {
        channel.current.wake();
      } else if (activeRef.current && status === 'offline') {
        void reconnect();
      }
    });
    return () => subscription.remove();
  }, [status, reconnect]);

  const claim = useCallback(
    async (host: string, setupCode: string) => {
      const url = gatewayBaseUrl(host);
      const result = await api.claim(url, setupCode.trim().toUpperCase(), CLIENT_NAME);
      const stored = storedFrom(result, url);
      await persist(stored);
      activate(stored.id);
      return stored;
    },
    [persist, activate],
  );

  const join = useCallback(
    async (host: string, inviteCode: string) => {
      const url = gatewayBaseUrl(host);
      const result = await api.join(url, inviteCode.trim().toUpperCase(), CLIENT_NAME);
      const stored = storedFrom(result, url);
      await persist(stored);
      activate(stored.id);
      return stored;
    },
    [persist, activate],
  );

  const gatewaysRef = useRef(gateways);
  useEffect(() => {
    gatewaysRef.current = gateways;
  }, [gateways]);

  // One at a time per session: the automatic connection, a refused token's retry and the screen's
  // button share it, but a new session never waits on (or inherits) the last one's attempt.
  const connectAccount = useCallback(async () => {
    const session = getSessionToken();
    if (!session) {
      return;
    }
    if (accountRun.current?.session === session) {
      await accountRun.current.run;
      return;
    }
    const run = (async () => {
      setAccountLink({ state: 'connecting' });
      try {
        const outcome = await loginWithAccount(CLIENT_NAME, gatewaysRef.current);
        if (getSessionToken() !== session) {
          // Signed out meanwhile: that access belonged to the session that ended.
          if (outcome.kind === 'connected') {
            void revokeOwnAccess(outcome.gateway);
          }
          return;
        }
        if (outcome.kind === 'no_gateway') {
          setAccountLink({ state: 'no_gateway' });
          return;
        }
        const id = outcome.kind === 'connected' ? outcome.gateway.id : outcome.gatewayId;
        if (outcome.kind === 'connected') {
          await persist(outcome.gateway);
          activate(id);
        } else if (activeRef.current?.id !== id) {
          activate(id);
        }
        setAccountLink({ state: 'connected', gatewayId: id });
      } catch (error) {
        if (getSessionToken() === session) {
          setAccountLink({ state: 'error', ...accountErrorOf(error) });
        }
      }
    })().finally(() => {
      if (accountRun.current?.run === run) {
        accountRun.current = null;
      }
    });
    accountRun.current = { session, run };
    await run;
  }, [persist, activate]);

  useEffect(() => {
    const session = signedIn ? getSessionToken() : null;
    const triedThisSession = session !== null && autoConnectedFor.current === session;
    if (shouldConnectOnSignIn({ signedIn, storeLoaded: status !== 'loading', gatewayCount: gateways.length, triedThisSession })) {
      autoConnectedFor.current = session;
      void connectAccount();
    }
  }, [signedIn, status, gateways.length, connectAccount]);

  // Each time the session becomes usable (signed in, or its password just set) is a fresh start.
  useEffect(() => {
    if (!signedIn) {
      refusalRetried.current.clear();
      autoConnectedFor.current = null;
    }
  }, [signedIn]);

  useEffect(() => {
    if (shouldRetryRefused({ gateway: active, refused: status === 'unauthorized', signedIn, retried: refusalRetried.current }) && active) {
      refusalRetried.current.add(active.id);
      void connectAccount();
    }
  }, [active, status, signedIn, connectAccount]);

  // Signed out (or found signed out at launch): the next person to sign in here must not inherit
  // the account's access. Gateways paired with a code stay. The revoke is sent while the token is
  // still at hand, and the entry goes whether or not the gateway answers it.
  useEffect(() => {
    if (status === 'loading') {
      return;
    }
    const doomed = removedOnSignOut(gateways, signedOut).filter((entry) => !dropping.current.has(entry.id));
    if (doomed.length === 0) {
      return;
    }
    const ids = new Set(doomed.map((entry) => entry.id));
    doomed.forEach((entry) => {
      dropping.current.add(entry.id);
      void revokeOwnAccess(entry);
    });
    void Promise.all(doomed.map((entry) => gatewayStore.remove(entry.id).catch(() => undefined))).then(() => {
      setGateways((current) => current.filter((entry) => !ids.has(entry.id)));
      if (activeRef.current && ids.has(activeRef.current.id)) {
        activate(gatewaysRef.current.find((entry) => !ids.has(entry.id))?.id ?? null);
      }
      ids.forEach((id) => dropping.current.delete(id));
    });
  }, [status, gateways, signedOut, activate]);

  const forget = useCallback(
    async (id: string) => {
      const entry = gateways.find((gateway) => gateway.id === id);
      // Forgotten on purpose: not connected straight back through the account this session (the button still can).
      autoConnectedFor.current = getSessionToken() ?? autoConnectedFor.current;
      // An account-issued token is given up on the gateway first, so it doesn't stay valid there.
      if (entry && isAccountIssued(entry)) {
        await revokeOwnAccess(entry);
      }
      await gatewayStore.remove(id);
      const rest = gateways.filter((entry) => entry.id !== id);
      setGateways(rest);
      if (activeId === id) {
        activate(rest[0]?.id ?? null);
      }
    },
    [activeId, gateways, activate],
  );

  const setRemoteEndpoints = useCallback(
    async (id: string, urls: string[]) => {
      const gateway = gateways.find((entry) => entry.id === id);
      if (!gateway) return;
      const remote = urls.map((url) => gatewayBaseUrl(url)).filter((url, index, all) => all.indexOf(url) === index);
      await persist({ ...gateway, endpoints: { ...gateway.endpoints, remote } });
    },
    [gateways, persist],
  );

  const select = useCallback((id: string) => activate(id), [activate]);

  const subscribe = useCallback((listener: (event: GatewayEvent) => void) => {
    listeners.current.add(listener);
    return () => {
      listeners.current.delete(listener);
    };
  }, []);

  const account = useMemo(() => accountLinkView(accountLink, gateways), [accountLink, gateways]);

  const value = useMemo<GatewayContextValue>(
    () => ({
      status,
      gateways,
      active,
      target,
      role: active?.role ?? null,
      devices,
      rooms,
      devicesLoaded,
      realtime,
      problem,
      claim,
      join,
      account,
      connectAccount,
      select,
      forget,
      setRemoteEndpoints,
      reconnect,
      refresh,
      upsertDevice,
      dropDevice,
      subscribe,
    }),
    [
      status,
      gateways,
      active,
      target,
      devices,
      rooms,
      devicesLoaded,
      realtime,
      problem,
      claim,
      join,
      account,
      connectAccount,
      select,
      forget,
      setRemoteEndpoints,
      reconnect,
      refresh,
      upsertDevice,
      dropDevice,
      subscribe,
    ],
  );

  return <GatewayContext.Provider value={value}>{children}</GatewayContext.Provider>;
}
