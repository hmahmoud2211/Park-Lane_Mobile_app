import { createContext, useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { AppState, Platform } from 'react-native';

import { gatewayBaseUrl } from '../constants/gatewayConfig';
import * as api from '../services/gateway/gatewayApi';
import { resolveEndpoint } from '../services/gateway/gatewayDiscovery';
import { GatewayError, onTokenRefused, type GatewayTarget } from '../services/gateway/gatewayHttp';
import { gatewayStore, type StoredGateway } from '../services/gateway/gatewayStore';
import { GatewayRealtime } from '../services/gateway/realtime';
import type { RealtimeState } from '../types/ems.types';
import type { ClaimResult, GatewayDevice, GatewayEvent, GatewayRoom } from '../types/gateway.types';

/**
 * The resident's CUBE Gateway: the box on their own Wi-Fi that finds, sets
 * up and controls devices locally (gateway/ in this repo). Holds the paired
 * gateways, picks a working address for the active one (home network first,
 * then Tailscale or relay), keeps its devices and rooms live over the event
 * channel, and lets screens listen to discovery, pairing and provisioning
 * events.
 *
 * Moving to a new address (the gateway's IP changed, or the phone left home)
 * only happens after that address proves it is the same gateway (hmac.ts);
 * the token is never sent anywhere unverified.
 */

export type GatewayStatus = 'loading' | 'none' | 'connecting' | 'online' | 'offline' | 'unauthorized';

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
  select: (id: string) => void;
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

const CLIENT_NAME = `Parklane on ${Platform.OS === 'ios' ? 'iPhone' : Platform.OS === 'android' ? 'Android' : 'the web'}`;

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
  };
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
            : 'Your gateway on CUBE’s server did not answer. Check your internet connection and try again.',
        );
        setDevicesLoaded(true);
        return;
      }
      const updated: StoredGateway = {
        ...gateway,
        lastUrl: endpoint.url,
        verifiedUrls: endpoint.newlyVerified ? [...gateway.verifiedUrls, endpoint.url].slice(-8) : gateway.verifiedUrls,
        endpoints: endpoint.lanChanged ? { ...gateway.endpoints, lan: endpoint.url } : gateway.endpoints,
      };
      if (updated.lastUrl !== gateway.lastUrl || endpoint.newlyVerified || endpoint.lanChanged) {
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
          setProblem('This gateway no longer accepts this phone. Pair it again, or ask its owner for an invite.');
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
          setProblem('This gateway no longer accepts this phone. Pair it again, or ask its owner for an invite.');
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
        setProblem('This gateway no longer accepts this phone. Pair it again, or ask its owner for an invite.');
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

  const forget = useCallback(
    async (id: string) => {
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
