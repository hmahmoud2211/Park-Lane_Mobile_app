import { useCallback, useEffect, useRef, useState } from 'react';

import { lgConfig } from '../constants/lgConfig';
import { EmsError, addLgAppliance, listLgAppliances } from '../services/ems/emsApi';
import { LgSetupError } from '../services/lg/lgSetupProtocol';
import { isLgHotspot } from '../services/lg/lgHotspot';
import { isLgSetupAvailable, sendWifiToAppliance } from '../services/lg/lgSetupService';
import {
  WifiProvisioningError,
  canScanForNetworks,
  detectHomeNetwork,
  isNativeWifiAvailable,
  joinNetwork,
  releaseDeviceNetwork,
  scanForHomeNetworks,
  scanForNetworks,
  type NearbyHotspot,
} from '../services/sonoff/wifiProvisioningService';
import type { LgAppliance } from '../types/ems.types';
import { useEms } from './useEms';

export type LgPairingStep = 'prepare' | 'wifi' | 'join' | 'finish';

/** After the AC took the settings: the phone back home, rethink finding the AC, the AC added. */
export type LgFinishPhase = 'home' | 'find' | 'name' | 'done';

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

class Cancelled extends Error {}

const AC_NETWORK = 'the AC’s LGE_ network';

function setupFailure(error: unknown): LgPairingError {
  if (error instanceof WifiProvisioningError) {
    return { title: 'Could not join the AC’s network', message: error.message };
  }
  if (error instanceof LgSetupError) {
    switch (error.kind) {
      case 'unreachable':
        return {
          title: 'The AC did not answer',
          message:
            'Check that the phone is on the AC’s LGE_ network and the AC is still in Wi-Fi setup mode. It leaves setup mode after a few minutes; hold the buttons again to restart it.',
        };
      case 'timeout':
        return { title: 'The AC stopped answering', message: `${error.message} Move closer to the AC and try again.` };
      case 'rejected':
        return { title: 'The AC refused the settings', message: error.message };
    }
  }
  return { title: 'Setup failed', message: 'The Wi-Fi settings could not be sent to the AC.' };
}

/**
 * Pairs an LG AC from the app, without LG's ThinQ app: setup mode, the home
 * Wi-Fi, then the phone joins the AC's hotspot and hands it that Wi-Fi the
 * way rethink-setup does. Back on home Wi-Fi it waits for the backend's
 * rethink bridge to report a new appliance, and adds it to the account.
 *
 * The Wi-Fi password stays in this hook's memory and is dropped on leaving.
 */
export function useLgPairing() {
  const { upsertDevice } = useEms();

  const [step, setStep] = useState<LgPairingStep>('prepare');
  const [backend, setBackend] = useState<LgBackendCheck>({ state: 'checking' });
  const [homeNetwork, setHomeNetwork] = useState<string | null>(null);
  const [homeNetworks, setHomeNetworks] = useState<NearbyHotspot[]>([]);
  const [scanningHomeNetworks, setScanningHomeNetworks] = useState(false);
  const [hotspots, setHotspots] = useState<NearbyHotspot[]>([]);
  const [scanningHotspots, setScanningHotspots] = useState(false);
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState<string | null>(null);
  const [error, setError] = useState<LgPairingError | null>(null);
  const [phase, setPhase] = useState<LgFinishPhase>('home');
  const [timedOut, setTimedOut] = useState(false);
  const [found, setFound] = useState<LgAppliance | null>(null);

  const homeWifi = useRef<HomeWifi | null>(null);
  /** Appliances rethink knew before this pairing; the new one is the first id not among them. */
  const known = useRef<Set<string>>(new Set());
  /** The hotspot the app asked the system to join, so it can be released. */
  const joined = useRef<string | null>(null);
  /** Bumped by cancel and unmount; a wait that sees a new value stops. */
  const runRef = useRef(0);

  const release = useCallback(async () => {
    const ssid = joined.current;
    joined.current = null;
    if (ssid) {
      await releaseDeviceNetwork(ssid);
    }
  }, []);

  // Leaving the screen ends any wait, forgets the password and hands the phone back its usual Wi-Fi.
  useEffect(
    () => () => {
      runRef.current += 1;
      homeWifi.current = null;
      void release();
    },
    [release],
  );

  // ---- Before starting: the backend must reach rethink ------------------------------

  /** Learns which appliances rethink already knows; state changes only once the backend answered. */
  const loadBackend = useCallback(() => {
    const run = runRef.current;
    return listLgAppliances().then(
      (result) => {
        if (run !== runRef.current) {
          return;
        }
        known.current = new Set(result.appliances.map((appliance) => appliance.id));
        setBackend(
          result.connected
            ? { state: 'ready' }
            : { state: 'failed', message: 'The EMS backend cannot reach rethink, the LG bridge. Check that it is running.' },
        );
      },
      (caught: unknown) => {
        if (run !== runRef.current) {
          return;
        }
        setBackend({
          state: 'failed',
          message:
            caught instanceof EmsError && caught.code === 'not_configured'
              ? 'LG appliances are not set up on the EMS backend yet (RETHINK_MQTT_URL).'
              : caught instanceof Error
                ? caught.message
                : 'The EMS backend could not be reached.',
        });
      },
    );
  }, []);

  useEffect(() => {
    void loadBackend();
  }, [loadBackend]);

  const checkBackend = useCallback(() => {
    setBackend({ state: 'checking' });
    void loadBackend();
  }, [loadBackend]);

  /** Reads the home network's name while the phone is still on it, for the Wi-Fi step. */
  const continueToWifi = useCallback(async () => {
    setBusy(true);
    const ssid = await detectHomeNetwork();
    setHomeNetwork(ssid && !isLgHotspot(ssid) ? ssid : null);
    setBusy(false);
    setStep('wifi');
  }, []);

  // ---- Home Wi-Fi ------------------------------------------------------------------

  const scanHomeNetworks = useCallback(async () => {
    if (!canScanForNetworks()) {
      return;
    }
    setScanningHomeNetworks(true);
    try {
      setHomeNetworks((await scanForHomeNetworks()).filter((network) => !isLgHotspot(network.ssid)));
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
  const scanHotspots = useCallback(async (): Promise<NearbyHotspot[]> => {
    if (!canScanForNetworks()) {
      return [];
    }
    setScanningHotspots(true);
    setError(null);
    try {
      const found = await scanForNetworks(isLgHotspot);
      setHotspots(found);
      return found;
    } catch (caught) {
      setError(setupFailure(caught));
      return [];
    } finally {
      setScanningHotspots(false);
    }
  }, []);

  /** Back on home Wi-Fi, the backend answers again; then rethink reports the AC once it calls in. */
  const waitForAppliance = useCallback(async () => {
    runRef.current += 1;
    const run = runRef.current;
    const wait = (ms: number) =>
      new Promise<void>((resolve, reject) =>
        setTimeout(() => (run === runRef.current ? resolve() : reject(new Cancelled())), ms),
      );
    setTimedOut(false);
    const deadline = Date.now() + lgConfig.discoveryWindowMs;
    try {
      while (Date.now() < deadline) {
        try {
          const { appliances } = await listLgAppliances();
          if (run !== runRef.current) {
            return;
          }
          setPhase('find');
          const fresh = appliances.find((appliance) => !known.current.has(appliance.id));
          if (fresh) {
            setFound(fresh);
            setPhase('name');
            return;
          }
        } catch {
          // Still on the AC's hotspot or between networks: the backend is out of reach until the phone is home.
        }
        await wait(lgConfig.discoveryPollMs);
      }
      setTimedOut(true);
    } catch (caught) {
      if (!(caught instanceof Cancelled)) {
        throw caught;
      }
    }
  }, []);

  /**
   * Joins the AC's hotspot (unless the resident already did, in settings),
   * sends the home Wi-Fi, then lets the phone go back to it.
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
      try {
        if (hotspot) {
          setActivity(`Joining ${hotspot.ssid}…`);
          joined.current = hotspot.ssid;
          await joinNetwork(hotspot.ssid, hotspot.password, AC_NETWORK);
        }
        setActivity('Sending your Wi-Fi to the AC…');
        await sendWifiToAppliance(wifi.ssid, wifi.password);
      } catch (caught) {
        setError(setupFailure(caught));
        await release();
        return;
      } finally {
        setBusy(false);
        setActivity(null);
      }
      homeWifi.current = null;
      await release();
      setPhase('home');
      setStep('finish');
      void waitForAppliance();
    },
    [release, waitForAppliance],
  );

  // ---- Adding it -------------------------------------------------------------------

  const add = useCallback(
    async (input: { name: string; room?: string }) => {
      if (!found) {
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const device = await addLgAppliance({ ...input, applianceId: found.id });
        upsertDevice(device);
        setPhase('done');
      } catch (caught) {
        setError({
          title: 'The AC was not added',
          message: caught instanceof EmsError ? caught.message : 'The AC could not be added. Try again.',
        });
      } finally {
        setBusy(false);
      }
    },
    [found, upsertDevice],
  );

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
    runRef.current += 1;
    homeWifi.current = null;
    await release();
  }, [release]);

  return {
    step,
    nativeWifi: isNativeWifiAvailable(),
    canScan: canScanForNetworks(),
    setupAvailable: isLgSetupAvailable(),
    backend,
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
    error,
    phase,
    timedOut,
    keepWaiting: waitForAppliance,
    found,
    add,
    back,
    cancel,
  };
}

export type LgPairing = ReturnType<typeof useLgPairing>;
