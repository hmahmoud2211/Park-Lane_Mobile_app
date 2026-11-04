import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import * as api from '../../../services/gateway/gatewayApi';
import { GatewayError } from '../../../services/gateway/gatewayHttp';
import { LgSetupError } from '../services/lgSetupProtocol';
import { isLgHotspot } from '../services/lgHotspot';
import { isLgSetupAvailable, sendWifiToAppliance } from '../services/lgSetupService';
import {
  WifiJoinError,
  canScanForNetworks,
  ensureWifiPermissions,
  getCurrentSsid,
  isNativeWifiAvailable,
  joinHotspot,
  releaseHotspot,
  scanForHotspots,
} from '../../../services/provisioning/wifiJoin';
import type { Brand, ProvisioningSession } from '../../../types/gateway.types';
import { useGateway } from '../../../hooks/useGateway';
import { useProvisioningSession } from '../../../hooks/useProvisioningSession';

export type LgPairingStep = 'prepare' | 'wifi' | 'join' | 'finish';

/** After the AC took the settings: the phone back home, the gateway finding the AC on ReThink, then paired. */
export type LgFinishPhase = 'home' | 'find' | 'done';

export interface LgPairingError {
  title: string;
  message: string;
}

export type LgBackendCheck = { state: 'checking' } | { state: 'ready' } | { state: 'failed'; message: string };

export interface HomeWifi {
  ssid: string;
  /** Empty for an open network. */
  password: string;
}

export interface NearbyNetwork {
  ssid: string;
}

/** The gateway's provisioning plugin for LG ThinQ setup from the phone (gateway/cube_gateway/provisioning/plugins.py). */
export const LG_PLUGIN_ID = 'lg_thinq_softap';
const LG_METHOD_ID = `setup:${LG_PLUGIN_ID}`;
/** LG setup networks: LGE_AC2_1234, LGE_AC-12-34-56, or [LG_<name>]<suffix> on some firmware. */
const LG_PREFIXES = ['LGE_', '[LG_', 'LG_'];

/** A failure on the AC's hotspot, as the user reads it and as the gateway's session records it. */
function setupFailure(error: unknown): LgPairingError & { code: string } {
  if (error instanceof WifiJoinError) {
    const code =
      error.kind === 'wrongPassword'
        ? 'hotspot_password_wrong'
        : error.kind === 'permissionDenied' || error.kind === 'locationServicesOff'
          ? 'permission_denied'
          : error.kind === 'cancelled'
            ? 'join_cancelled'
            : 'hotspot_not_found';
    return { code, title: 'Could not join the AC’s network', message: error.message };
  }
  if (error instanceof LgSetupError) {
    switch (error.kind) {
      case 'unreachable':
        return {
          code: 'device_not_reachable_on_ap',
          title: 'The AC did not answer',
          message:
            'Check that the phone is on the AC’s LGE_ network and the AC is still in Wi-Fi setup mode. It leaves setup mode after a few minutes; hold the buttons again to restart it.',
        };
      case 'timeout':
        return { code: 'device_not_reachable_on_ap', title: 'The AC stopped answering', message: `${error.message} Move closer to the AC and try again.` };
      case 'rejected':
        return { code: 'provisioning_protocol_failed', title: 'The AC refused the settings', message: error.message };
    }
  }
  return { code: 'provisioning_protocol_failed', title: 'Setup failed', message: 'The Wi-Fi settings could not be sent to the AC.' };
}

const describe = (error: unknown, fallback: string) =>
  error instanceof GatewayError ? [error.message, error.recovery].filter(Boolean).join(' ') : fallback;

/** Whether the gateway offers LG setup from the phone (ReThink configured), from its brand list. */
function backendFrom(brands: Brand[]): LgBackendCheck {
  const method = brands.find((brand) => brand.id === 'lg')?.methods.find((entry) => entry.id === LG_METHOD_ID);
  if (!method) {
    return { state: 'failed', message: 'This gateway does not offer LG setup from the phone. Update the gateway.' };
  }
  if (!method.available) {
    return { state: 'failed', message: method.unavailable_reason ?? 'LG setup is not available on this gateway.' };
  }
  return { state: 'ready' };
}

const serversOf = (session: ProvisioningSession | null) =>
  session?.setup.rethink_api_server && session.setup.rethink_mqtt_server
    ? { apiServer: session.setup.rethink_api_server, mqttServer: session.setup.rethink_mqtt_server }
    : null;

/**
 * Pairs an LG AC from the app, without LG's ThinQ app, through the CUBE
 * Gateway (ported from Master's hook, archive/master-2026-11-04): setup mode,
 * the home Wi-Fi, then the phone joins the AC's hotspot and hands it that
 * Wi-Fi the way rethink-setup does. The gateway's provisioning session
 * (plugin lg_thinq_softap) records each step; reports made while the phone is
 * on the hotspot are queued and sent once the gateway answers again. Back on
 * home Wi-Fi the gateway waits for ReThink to report the new appliance and
 * pairs it; only then is the session `connected`.
 *
 * The Wi-Fi password stays in this hook's memory and is dropped on leaving.
 */
export function useLgPairing() {
  const gateway = useGateway();
  const { target, status } = gateway;
  const provisioning = useProvisioningSession();
  const { session } = provisioning;

  const [step, setStep] = useState<LgPairingStep>('prepare');
  const [checked, setBackend] = useState<LgBackendCheck>({ state: 'checking' });
  const [homeNetwork, setHomeNetwork] = useState<string | null>(null);
  const [homeNetworks, setHomeNetworks] = useState<NearbyNetwork[]>([]);
  const [scanningHomeNetworks, setScanningHomeNetworks] = useState(false);
  const [hotspots, setHotspots] = useState<NearbyNetwork[]>([]);
  const [scanningHotspots, setScanningHotspots] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<string | null>(null);
  const [error, setError] = useState<LgPairingError | null>(null);

  const homeWifi = useRef<HomeWifi | null>(null);
  /** The hotspot the app asked the system to join, so it can be released. */
  const joined = useRef<string | null>(null);
  const sessionRef = useRef<ProvisioningSession | null>(null);
  /** Set after a failed attempt: that session is (being) closed, so a retry starts a new one. */
  const stale = useRef(false);
  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  const release = useCallback(async () => {
    const ssid = joined.current;
    joined.current = null;
    if (ssid) {
      await releaseHotspot(ssid);
    }
  }, []);

  // Leaving the screen forgets the password, hands the phone back its usual Wi-Fi and closes an unfinished session.
  const cancelRef = useRef(provisioning.cancel);
  useEffect(() => {
    cancelRef.current = provisioning.cancel;
  }, [provisioning.cancel]);
  useEffect(
    () => () => {
      homeWifi.current = null;
      void release();
      void cancelRef.current();
    },
    [release],
  );

  // ---- Before starting: the gateway must offer LG setup (ReThink configured) -------------------

  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!target) {
      return;
    }
    let cancelled = false;
    api.listBrands(target).then(
      (brands) => {
        if (!cancelled) setBackend(backendFrom(brands));
      },
      (caught: unknown) => {
        if (!cancelled) setBackend({ state: 'failed', message: describe(caught, 'The gateway could not be reached.') });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [target, attempt]);

  const checkBackend = useCallback(() => {
    setBackend({ state: 'checking' });
    setAttempt((current) => current + 1);
  }, []);

  const backend: LgBackendCheck = target
    ? checked
    : { state: 'failed', message: status === 'none' ? 'Connect your CUBE Gateway first.' : 'Your CUBE Gateway is not reachable right now.' };

  /** A session that is still open, or a new one (after a failed attempt the old one is closed). */
  const ensureSession = useCallback(async (): Promise<ProvisioningSession | null> => {
    const current = sessionRef.current;
    if (current && !stale.current && current.state !== 'pairing_failed' && current.state !== 'connected') {
      return current;
    }
    if (stale.current) {
      // Deliver the old session's failure first; whatever cannot be sent now is dropped with it.
      await provisioning.flush();
      stale.current = false;
    }
    provisioning.reset();
    const opened = await provisioning.open(LG_PLUGIN_ID, null);
    if (opened) {
      sessionRef.current = opened;
      await provisioning.report('pairing_mode_confirmed');
    }
    return opened;
  }, [provisioning]);

  /** Opens the session and reads the home network's name while the phone is still on it, for the Wi-Fi step. */
  const continueToWifi = useCallback(async () => {
    setBusy(true);
    setError(null);
    const opened = await ensureSession();
    if (!opened) {
      setBusy(false);
      return;
    }
    if (canScanForNetworks()) {
      await ensureWifiPermissions().catch(() => undefined);
    }
    const ssid = await getCurrentSsid();
    setHomeNetwork(ssid && !isLgHotspot(ssid) ? ssid : null);
    setBusy(false);
    setStep('wifi');
  }, [ensureSession]);

  // ---- Home Wi-Fi ------------------------------------------------------------------

  const scanHomeNetworks = useCallback(async () => {
    if (!canScanForNetworks()) {
      return;
    }
    setScanningHomeNetworks(true);
    try {
      // An empty prefix lists every network in range, strongest first.
      setHomeNetworks((await scanForHotspots([''])).filter((ssid) => !isLgHotspot(ssid)).map((ssid) => ({ ssid })));
    } catch {
      // The resident can still type the name.
    } finally {
      setScanningHomeNetworks(false);
    }
  }, []);

  const submitWifi = useCallback((wifi: HomeWifi) => {
    homeWifi.current = wifi;
    setError(null);
    setStep('join');
  }, []);

  // ---- The AC's hotspot, and the settings --------------------------------------------

  /** Android only: the LG hotspots in range, also returned for a caller that needs them at once. */
  const scanHotspots = useCallback(async (): Promise<NearbyNetwork[]> => {
    if (!canScanForNetworks()) {
      return [];
    }
    setScanningHotspots(true);
    setError(null);
    try {
      const found = (await scanForHotspots(LG_PREFIXES)).filter(isLgHotspot).map((ssid) => ({ ssid }));
      setHotspots(found);
      return found;
    } catch (caught) {
      setError(setupFailure(caught));
      return [];
    } finally {
      setScanningHotspots(false);
    }
  }, []);

  /**
   * Joins the AC's hotspot (unless the resident already did, in settings),
   * sends the home Wi-Fi, then lets the phone go back to it and hands the
   * rest to the gateway.
   */
  const send = useCallback(
    async (hotspot: { ssid: string; password: string | null } | null) => {
      const wifi = homeWifi.current;
      if (!wifi) {
        setStep('wifi');
        return;
      }
      setBusy(true);
      setError(null);
      const current = await ensureSession();
      if (!current) {
        setBusy(false);
        return;
      }
      try {
        let ssid: string | null;
        if (hotspot) {
          setActivity(`Joining ${hotspot.ssid}…`);
          await provisioning.report('joining_device_ap');
          joined.current = hotspot.ssid;
          ssid = (await joinHotspot({ ssid: hotspot.ssid, prefixes: LG_PREFIXES, password: hotspot.password })) ?? hotspot.ssid;
        } else {
          ssid = await getCurrentSsid();
        }
        // The phone is on the AC's network now: the gateway is out of reach, so reports are queued.
        await provisioning.report('device_ap_joined', ssid && isLgHotspot(ssid) ? { ssid } : {}, { queueIfUnreachable: true });
        setActivity('Sending your Wi-Fi to the AC…');
        const protocol = await sendWifiToAppliance(wifi.ssid, wifi.password, serversOf(current));
        await provisioning.report('wifi_config_sent', { protocol }, { queueIfUnreachable: true });
      } catch (caught) {
        const failure = setupFailure(caught);
        setError({ title: failure.title, message: failure.message });
        await release();
        stale.current = true;
        await provisioning.report('failed', { code: failure.code, message: failure.message }, { queueIfUnreachable: true });
        return;
      } finally {
        setBusy(false);
        setActivity(null);
      }
      homeWifi.current = null;
      await release();
      await provisioning.report('phone_returned', {}, { queueIfUnreachable: true });
      provisioning.watch();
      void gateway.reconnect();
      setStep('finish');
    },
    [ensureSession, provisioning, release, gateway],
  );

  // ---- After the AC took the settings: what the gateway's session says --------------

  const phase: LgFinishPhase =
    session?.state === 'connected' ? 'done' : session?.state === 'waiting_for_device' || session?.state === 'local_authorization_required' ? 'find' : 'home';
  const finishError = step === 'finish' && session?.state === 'pairing_failed' ? session.error : null;
  const timedOut = finishError?.code === 'device_not_found';
  const deviceId = session?.state === 'connected' ? session.device_id : null;

  // ---- Navigation ------------------------------------------------------------------

  /** One step back within the wizard; false when there is nowhere to go back to. */
  const back = useCallback((): boolean => {
    if (busy || step === 'prepare' || step === 'finish') {
      return false;
    }
    setError(null);
    setStep(step === 'join' ? 'wifi' : 'prepare');
    return true;
  }, [busy, step]);

  const cancel = useCallback(async () => {
    homeWifi.current = null;
    await release();
    await provisioning.cancel();
  }, [provisioning, release]);

  const remote = useMemo(() => serversOf(session) !== null, [session]);

  return {
    step,
    nativeWifi: isNativeWifiAvailable(),
    canScan: canScanForNetworks(),
    setupAvailable: isLgSetupAvailable(),
    backend,
    remote,
    checkBackend,
    continueToWifi,
    homeNetwork,
    homeNetworks,
    scanningHomeNetworks,
    scanHomeNetworks,
    submitWifi,
    hotspots,
    scanningHotspots,
    scanHotspots,
    send,
    busy,
    activity,
    error: error ?? (provisioning.error ? { title: 'The gateway did not accept that step', message: provisioning.error } : null),
    phase,
    timedOut,
    finishError,
    deviceId,
    session,
    back,
    cancel,
  };
}

export type LgPairing = ReturnType<typeof useLgPairing>;
