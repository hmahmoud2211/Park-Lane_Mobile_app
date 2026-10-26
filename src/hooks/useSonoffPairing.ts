import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';

import { sonoffConfig } from '../constants/sonoffConfig';
import {
  BackendError,
  discoverSonoff,
  getBackendHealth,
  isBackendConfigured,
  registerSonoff,
  setDevicePower,
} from '../services/cube/cubeBackendService';
import * as ems from '../services/ems/emsApi';
import { sendWifiCredentialsExperimental } from '../services/sonoff/experimental/apProvisioning';
import {
  SonoffDeviceError,
  checkDeviceConnectivity,
  detectSonoffDevice,
} from '../services/sonoff/sonoffDeviceService';
import {
  WifiProvisioningError,
  canScanForNetworks,
  connectToDeviceNetwork,
  getCurrentSsid,
  isNativeWifiAvailable,
  isSetupHotspot,
  releaseDeviceNetwork,
  scanForSetupHotspots,
  type NearbyHotspot,
} from '../services/sonoff/wifiProvisioningService';
import type {
  ApPayloadFormat,
  ApProvisioningOutcome,
  DeviceKey,
  DeviceNetworkState,
  PairingError,
  PairingErrorKind,
  PairingStatus,
  PairingStep,
  SonoffDeviceInfo,
  SonoffLanDevice,
  SonoffRegistration,
} from '../types/sonoff.types';

/** The stages after the Wi-Fi form, each shown with its own state. */
export type ProgressPhaseId = 'send' | 'leave' | 'home' | 'find' | 'hub';
export type ProgressPhaseState = 'pending' | 'active' | 'done' | 'failed' | 'skipped';

export interface WifiSettings {
  ssid: string;
  /** Passed straight to the plug; the hook never keeps it. */
  password: string;
  serverName: string;
  port: number;
  format: ApPayloadFormat;
}

export interface ControlTest {
  state: 'idle' | 'busy' | 'ok' | 'failed';
  power?: 'on' | 'off';
  message?: string;
}

interface PairingState {
  step: PairingStep;
  status: PairingStatus;
  /** A request or wait is under way; buttons that would start another are disabled. */
  busy: boolean;
  /** What the flow is doing right now, e.g. "Joining ITEAD-…". */
  activity: string | null;
  error: PairingError | null;
  hotspots: NearbyHotspot[];
  selectedHotspot: string | null;
  network: DeviceNetworkState;
  device: SonoffDeviceInfo | null;
  /** True when the resident said the plug already knows their Wi-Fi. */
  skippedProvisioning: boolean;
  provisionOutcome: ApProvisioningOutcome | null;
  phases: Record<ProgressPhaseId, ProgressPhaseState>;
  lanDevice: SonoffLanDevice | null;
  registration: SonoffRegistration | null;
  controlTest: ControlTest;
}

const PENDING_PHASES: Record<ProgressPhaseId, ProgressPhaseState> = {
  send: 'pending',
  leave: 'pending',
  home: 'pending',
  find: 'pending',
  hub: 'pending',
};

const INITIAL_STATE: PairingState = {
  step: 'instructions',
  status: 'waitingForPairing',
  busy: false,
  activity: null,
  error: null,
  hotspots: [],
  selectedHotspot: null,
  network: { ssid: null, deviceReachable: null },
  device: null,
  skippedProvisioning: false,
  provisionOutcome: null,
  phases: PENDING_PHASES,
  lanDevice: null,
  registration: null,
  controlTest: { state: 'idle' },
};

/** Steps the progress page can be left from without abandoning a request. */
const SETTLED: readonly PairingStatus[] = ['provisioningFailed', 'registrationRequired', 'deviceDiscovered', 'setupCompleted'];

/** How long to wait for the phone to rejoin home Wi-Fi once off the hotspot. */
const HOME_WIFI_WINDOW_MS = 45_000;
const HOME_WIFI_POLL_MS = 3_000;
/** Without a provisioning request, the resident has to power-cycle the plug first. */
const SKIP_HOTSPOT_WINDOW_MS = 120_000;

class Cancelled extends Error {}

/** Thrown inside a run; caught at its end and shown as the run's error. */
class PairingFailure extends Error {
  readonly kind: PairingErrorKind;

  constructor(kind: PairingErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

const failure = (kind: PairingErrorKind, message: string): PairingError => ({ kind, message });

function asPairingError(error: unknown): PairingError {
  if (error instanceof PairingFailure) {
    return failure(error.kind, error.message);
  }
  return failure('unknown', error instanceof Error ? error.message : 'Something went wrong.');
}

function wifiFailure(error: unknown): PairingError {
  if (!(error instanceof WifiProvisioningError)) {
    return failure('unknown', 'The phone could not join the device’s network.');
  }
  const kinds: Record<WifiProvisioningError['kind'], PairingErrorKind> = {
    unavailable: 'unsupportedPlatform',
    permissionDenied: 'permissionDenied',
    locationServicesOff: 'locationServicesOff',
    notFound: 'hotspotNotFound',
    cancelled: 'joinCancelled',
    timeout: 'timeout',
    failed: 'unknown',
  };
  return failure(kinds[error.kind], error.message);
}

function backendFailure(error: unknown): PairingError {
  if (error instanceof ems.EmsError) {
    const emsKinds: Partial<Record<string, PairingErrorKind>> = {
      not_configured: 'backendNotConfigured',
      network: 'backendUnreachable',
      timeout: 'backendUnreachable',
      device_not_found: 'deviceNotFound',
      key_rejected: 'keyRejected',
      unsupported_device: 'unsupportedDevice',
      device_unreachable: 'notControllable',
      device_offline: 'notControllable',
      command_timeout: 'notControllable',
    };
    return failure(emsKinds[error.code] ?? 'unknown', error.message);
  }
  if (!(error instanceof BackendError)) {
    return failure('unknown', 'Something went wrong talking to the device backend.');
  }
  const kinds: Partial<Record<BackendError['code'], PairingErrorKind>> = {
    not_configured: 'backendNotConfigured',
    public_url_missing: 'backendNotConfigured',
    network: 'backendUnreachable',
    timeout: 'backendUnreachable',
    cube_unreachable: 'cubeUnreachable',
    cube_auth: 'cubeRejected',
    cube_rejected: 'cubeRejected',
    device_not_found: 'deviceNotFound',
    key_rejected: 'keyRejected',
    unsupported_device: 'unsupportedDevice',
    not_controllable: 'notControllable',
    device_unreachable: 'notControllable',
  };
  return failure(kinds[error.code] ?? 'unknown', error.message);
}

/**
 * The SONOFF Wi-Fi pairing flow, from pairing mode to a plug the CUBE hub can
 * switch. Each stage is only reported once it has been observed: the phone
 * is "connected" when the plug answers `/device`, the plug has "joined"
 * Wi-Fi when the backend finds it on the LAN, and setup is complete when the
 * hub has registered it.
 *
 * The plug's key lives in a ref and the Wi-Fi password is never stored.
 */
export function useSonoffPairing() {
  const [state, setState] = useState<PairingState>(INITIAL_STATE);
  // Read by async runs, which outlive the render that started them.
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  const keyRef = useRef<DeviceKey | null>(null);
  /** The hotspot the app asked the system to join, so it can be released. */
  const joinedRef = useRef<{ ssid: string | null } | null>(null);
  /** Bumped by cancel, back and unmount; a run that sees a new value stops. */
  const runRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const retryRef = useRef<(() => void) | null>(null);
  /** The actions a retry can repeat, filled in once they are all declared. */
  const actionsRef = useRef<{
    scanHotspots?: () => Promise<void>;
    detect?: () => Promise<void>;
    joinHotspot?: () => Promise<void>;
    register?: (name: string) => Promise<void>;
  }>({});

  const patch = useCallback((next: Partial<PairingState>) => {
    setState((current) => ({ ...current, ...next }));
  }, []);

  const setPhase = useCallback((id: ProgressPhaseId, value: ProgressPhaseState) => {
    setState((current) => ({ ...current, phases: { ...current.phases, [id]: value } }));
  }, []);

  /** Starts a run: stops any earlier one, and returns a guard for this one. */
  const begin = useCallback(() => {
    runRef.current += 1;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const id = runRef.current;
    const guard = () => {
      if (id !== runRef.current) {
        throw new Cancelled();
      }
    };
    const wait = (ms: number) =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => (id === runRef.current ? resolve() : reject(new Cancelled())), ms);
        controller.signal.addEventListener('abort', () => {
          clearTimeout(timer);
          reject(new Cancelled());
        });
      });
    return { guard, wait, signal: controller.signal };
  }, []);

  const stop = useCallback(() => {
    runRef.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const release = useCallback(async () => {
    const joined = joinedRef.current;
    joinedRef.current = null;
    if (joined) {
      await releaseDeviceNetwork(joined.ssid);
    }
  }, []);

  // Leaving the screen ends any wait and hands the phone back its usual Wi-Fi.
  useEffect(
    () => () => {
      stop();
      keyRef.current = null;
      void release();
    },
    [release, stop],
  );

  // ---- Stage 2: the setup hotspot -------------------------------------------------

  const scanHotspots = useCallback(async () => {
    const run = begin();
    retryRef.current = () => void actionsRef.current.scanHotspots?.();
    patch({ busy: true, error: null, activity: 'Looking for ITEAD- networks…' });
    try {
      const hotspots = await scanForSetupHotspots();
      run.guard();
      patch({
        hotspots,
        selectedHotspot: hotspots.length === 1 ? hotspots[0].ssid : stateRef.current.selectedHotspot,
        error:
          hotspots.length === 0
            ? failure('hotspotNotFound', 'No ITEAD- network is in range yet.')
            : null,
      });
    } catch (error) {
      if (!(error instanceof Cancelled)) {
        patch({ error: wifiFailure(error) });
      }
    } finally {
      patch({ busy: false, activity: null });
    }
  }, [begin, patch]);

  const startConnecting = useCallback(() => {
    patch({ step: 'connect', status: 'connectingToDevice', error: null });
    if (canScanForNetworks() && stateRef.current.hotspots.length === 0) {
      void scanHotspots();
    }
  }, [patch, scanHotspots]);

  /** Stage 3: asks the plug for its details, which is the only proof the phone reached it. */
  const detect = useCallback(async () => {
    const run = begin();
    retryRef.current = () => void actionsRef.current.detect?.();
    patch({ busy: true, error: null, activity: 'Checking for the plug at 10.10.7.1…' });
    try {
      if (Platform.OS === 'web') {
        throw new PairingFailure(
          'unsupportedPlatform',
          'Browsers cannot reach a device’s setup network. Use the Parklane app on your phone.',
        );
      }
      const ssid = await getCurrentSsid();
      run.guard();
      patch({ network: { ssid, deviceReachable: null } });
      try {
        const { info, key } = await detectSonoffDevice({ signal: run.signal });
        run.guard();
        keyRef.current = key;
        patch({
          device: info,
          status: 'deviceDetected',
          network: { ssid, deviceReachable: true },
        });
      } catch (error) {
        if (error instanceof Cancelled || (error instanceof SonoffDeviceError && error.kind === 'aborted')) {
          throw new Cancelled();
        }
        patch({ network: { ssid, deviceReachable: false } });
        if (error instanceof SonoffDeviceError && error.kind === 'invalidResponse') {
          throw new PairingFailure('invalidResponse', error.message);
        }
        if (ssid && !isSetupHotspot(ssid)) {
          throw new PairingFailure('wrongNetwork', `Your phone is on “${ssid}”, not the plug’s ITEAD- network.`);
        }
        if (ssid && Platform.OS === 'ios') {
          // On the hotspot but nothing gets through: what iOS does when Local Network access is off.
          throw new PairingFailure('localNetworkDenied', `Your phone is on “${ssid}”, but Parklane could not reach the plug.`);
        }
        throw new PairingFailure(
          'timeout',
          error instanceof SonoffDeviceError && error.kind === 'timeout'
            ? 'The plug did not answer at 10.10.7.1.'
            : 'Could not reach the plug at 10.10.7.1.',
        );
      }
    } catch (error) {
      if (!(error instanceof Cancelled)) {
        patch({ error: asPairingError(error) });
      }
    } finally {
      patch({ busy: false, activity: null });
    }
  }, [begin, patch]);

  /** Asks the system to join the hotspot, then checks for the plug. */
  const joinHotspot = useCallback(async () => {
    const run = begin();
    retryRef.current = () => void actionsRef.current.joinHotspot?.();
    const target = stateRef.current.selectedHotspot ?? undefined;
    patch({
      busy: true,
      error: null,
      activity: target ? `Joining ${target}…` : 'Joining the plug’s ITEAD- network…',
    });
    try {
      const ssid = await connectToDeviceNetwork(target);
      run.guard();
      joinedRef.current = { ssid: ssid ?? target ?? null };
      patch({ network: { ssid, deviceReachable: null } });
    } catch (error) {
      if (!(error instanceof Cancelled)) {
        patch({ error: wifiFailure(error), busy: false, activity: null });
      }
      return;
    }
    await detect();
  }, [begin, detect, patch]);

  /**
   * Set when the resident goes to system settings to join the hotspot by
   * hand, so the check runs when they come back. Without the native module
   * that is the only way in, so it is always on.
   */
  const manualJoinRef = useRef(!isNativeWifiAvailable());
  const markManualJoin = useCallback(() => {
    manualJoinRef.current = true;
  }, []);

  useEffect(() => {
    if (Platform.OS === 'web') {
      return undefined;
    }
    const subscription = AppState.addEventListener('change', (next) => {
      const current = stateRef.current;
      if (next === 'active' && manualJoinRef.current && current.step === 'connect' && !current.device && !current.busy) {
        void detect();
      }
    });
    return () => subscription.remove();
  }, [detect]);

  const continueToWifi = useCallback(() => {
    patch({ step: 'wifi', error: null });
  }, [patch]);

  // ---- Stage 5: back to home Wi-Fi, and find the plug there ----------------------

  type Run = ReturnType<typeof begin>;

  /** Waits for the hotspot to go: some consecutive silences from `/device`. */
  const awaitHotspotGone = useCallback(
    async (run: Run, windowMs: number) => {
      setPhase('leave', 'active');
      patch({ status: 'waitingForReconnection', activity: 'Waiting for the plug to leave pairing mode…' });
      const endsAt = Date.now() + windowMs;
      let misses = 0;
      while (Date.now() < endsAt) {
        const there = await checkDeviceConnectivity({ timeoutMs: 2_000, signal: run.signal });
        run.guard();
        misses = there ? 0 : misses + 1;
        if (misses >= sonoffConfig.hotspotGoneMisses) {
          setPhase('leave', 'done');
          return;
        }
        await run.wait(sonoffConfig.hotspotPollMs);
      }
      setPhase('leave', 'failed');
      throw new PairingFailure(
        'stillInPairingMode',
        stateRef.current.skippedProvisioning
          ? 'The plug is still in pairing mode.'
          : 'The plug is still in pairing mode, so it did not take the Wi-Fi settings.',
      );
    },
    [patch, setPhase],
  );

  /** Off the hotspot and on a network where the backend answers. */
  const awaitHomeNetwork = useCallback(
    async (run: Run, homeSsid: string | null) => {
      setPhase('home', 'active');
      await release();
      run.guard();
      patch({
        activity: homeSsid ? `Waiting for your phone to rejoin “${homeSsid}”…` : 'Waiting for your phone to rejoin your home Wi-Fi…',
      });
      if (!isBackendConfigured()) {
        setPhase('home', 'skipped');
        throw new PairingFailure(
          'backendNotConfigured',
          'This build has no device backend, so Parklane cannot look for the plug on your network.',
        );
      }
      const endsAt = Date.now() + HOME_WIFI_WINDOW_MS;
      let ssid: string | null = null;
      while (Date.now() < endsAt) {
        ssid = await getCurrentSsid();
        run.guard();
        patch({ network: { ssid, deviceReachable: false } });
        const health = await getBackendHealth(run.signal).catch(() => null);
        run.guard();
        if (health) {
          setPhase('home', 'done');
          return;
        }
        await run.wait(HOME_WIFI_POLL_MS);
      }
      setPhase('home', 'failed');
      throw isSetupHotspot(ssid)
        ? new PairingFailure('notOnHomeWifi', `Your phone is still on “${ssid}”.`)
        : new PairingFailure('backendUnreachable', 'Parklane could not reach the device backend from this network.');
    },
    [patch, release, setPhase],
  );

  /** Polls the backend's mDNS view of the LAN until the plug appears. */
  const findOnNetwork = useCallback(
    async (run: Run) => {
      const device = stateRef.current.device;
      const key = keyRef.current;
      if (!device || !key) {
        throw new PairingFailure('unknown', 'The plug’s details were lost. Start again.');
      }
      setPhase('find', 'active');
      patch({ activity: 'Looking for the plug on your network…' });
      const endsAt = Date.now() + sonoffConfig.discoveryWindowMs;
      while (Date.now() < endsAt) {
        let result;
        try {
          result = await discoverSonoff(device.deviceId, key, run.signal);
        } catch (error) {
          run.guard();
          // A dropped request is retried; anything the backend refused is not.
          if (!(error instanceof BackendError) || (error.code !== 'network' && error.code !== 'timeout')) {
            setPhase('find', 'failed');
            const reason = backendFailure(error);
            throw new PairingFailure(reason.kind, reason.message);
          }
          result = { found: false as const };
        }
        run.guard();
        if (result.found) {
          const lan = result.device;
          patch({ lanDevice: lan });
          if (lan.keyVerified === false) {
            setPhase('find', 'failed');
            throw new PairingFailure('keyRejected', 'The plug is on your network, but its key did not unlock its status.');
          }
          if (!lan.singleChannel) {
            setPhase('find', 'failed');
            throw new PairingFailure('unsupportedDevice', 'The plug is on your network, but it reports several channels.');
          }
          setPhase('find', 'done');
          return;
        }
        await run.wait(sonoffConfig.discoveryPollMs);
      }
      setPhase('find', 'failed');
      throw new PairingFailure('deviceNotFound', 'The plug did not appear on your network within two and a half minutes.');
    },
    [patch, setPhase],
  );

  /** Runs `steps`, then lands on the status they reached, or the right failure. */
  const runProgress = useCallback(
    async (steps: (run: Run) => Promise<void>) => {
      const run = begin();
      patch({ busy: true, error: null });
      try {
        await steps(run);
        patch({ status: 'deviceDiscovered' });
      } catch (error) {
        if (error instanceof Cancelled) {
          return;
        }
        const reason = asPairingError(error);
        const needsRegistration: PairingErrorKind[] = [
          'backendNotConfigured',
          'backendUnreachable',
          'keyRejected',
          'unsupportedDevice',
          'cubeUnreachable',
        ];
        patch({
          error: reason,
          status: needsRegistration.includes(reason.kind) ? 'registrationRequired' : 'provisioningFailed',
        });
      } finally {
        patch({ busy: false, activity: null });
      }
    },
    [begin, patch],
  );

  const resumeAfterProvisioning = useCallback(
    (homeSsid: string | null, hotspotWindowMs: number) =>
      runProgress(async (run) => {
        const phases = stateRef.current.phases;
        if (phases.leave !== 'done') {
          await awaitHotspotGone(run, hotspotWindowMs);
        }
        if (phases.home !== 'done') {
          await awaitHomeNetwork(run, homeSsid);
        }
        await findOnNetwork(run);
      }),
    [awaitHomeNetwork, awaitHotspotGone, findOnNetwork, runProgress],
  );

  // ---- Stage 4: Wi-Fi settings ------------------------------------------------------

  const backToForm = useCallback(() => {
    stop();
    patch({
      step: 'wifi',
      status: 'deviceDetected',
      error: null,
      busy: false,
      activity: null,
      phases: PENDING_PHASES,
    });
  }, [patch, stop]);

  /** EXPERIMENTAL: the resident confirmed sending these settings to the plug. */
  const provisionExperimental = useCallback(
    (settings: WifiSettings) => {
      const homeSsid = settings.ssid;
      patch({
        step: 'progress',
        status: 'configuringWifi',
        skippedProvisioning: false,
        provisionOutcome: null,
        phases: { ...PENDING_PHASES, send: 'active' },
        lanDevice: null,
      });
      retryRef.current = () => void resumeAfterProvisioning(homeSsid, sonoffConfig.hotspotGoneWindowMs);
      void runProgress(async (run) => {
        patch({ activity: 'Sending your Wi-Fi settings to the plug…' });
        const outcome = await sendWifiCredentialsExperimental({ ...settings, confirmed: true });
        run.guard();
        patch({ provisionOutcome: outcome });
        if (outcome.kind !== 'accepted' && outcome.kind !== 'noResponse') {
          // Nothing to resume: retrying means sending again, from the form.
          retryRef.current = backToForm;
        }
        if (outcome.kind === 'rejected') {
          setPhase('send', 'failed');
          throw new PairingFailure(
            'provisioningRejected',
            `The plug refused the settings (HTTP ${outcome.status}${outcome.code !== undefined ? `, error ${outcome.code}` : ''}).`,
          );
        }
        if (outcome.kind === 'unreachable') {
          setPhase('send', 'failed');
          throw new PairingFailure('timeout', 'The settings could not be sent: the plug was not reachable.');
        }
        // `noResponse` proves nothing, so the hotspot check below decides.
        setPhase('send', 'done');
        await awaitHotspotGone(run, sonoffConfig.hotspotGoneWindowMs);
        await awaitHomeNetwork(run, homeSsid);
        await findOnNetwork(run);
      });
    },
    [awaitHomeNetwork, awaitHotspotGone, backToForm, findOnNetwork, patch, resumeAfterProvisioning, runProgress, setPhase],
  );

  /** The plug was set up on this Wi-Fi before; it only needs to leave pairing mode. */
  const skipProvisioning = useCallback(() => {
    patch({
      step: 'progress',
      status: 'waitingForReconnection',
      skippedProvisioning: true,
      provisionOutcome: null,
      phases: { ...PENDING_PHASES, send: 'skipped' },
      lanDevice: null,
    });
    retryRef.current = () => void resumeAfterProvisioning(null, SKIP_HOTSPOT_WINDOW_MS);
    void resumeAfterProvisioning(null, SKIP_HOTSPOT_WINDOW_MS);
  }, [patch, resumeAfterProvisioning]);

  // ---- Stage 6: the hub -------------------------------------------------------------

  const register = useCallback(
    async (name: string) => {
      const device = stateRef.current.device;
      const key = keyRef.current;
      if (!device || !key) {
        return;
      }
      const run = begin();
      retryRef.current = () => void actionsRef.current.register?.(name);
      setPhase('hub', 'active');
      // Signed in to EMS: the plug joins the user's registry (app + Alexa). Otherwise the CUBE hub, as before.
      const toEms = ems.getSessionToken() !== null;
      patch({ busy: true, error: null, activity: toEms ? 'Adding the plug to your EMS devices…' : 'Adding the plug to your hub…' });
      try {
        const registration: SonoffRegistration = toEms
          ? {
              target: 'ems',
              emsDeviceId: (await ems.addSonoffDevice({ name, deviceId: device.deviceId, deviceKey: key.reveal() })).id,
              device: stateRef.current.lanDevice,
            }
          : await registerSonoff(device.deviceId, key, name);
        run.guard();
        setPhase('hub', 'done');
        patch({ registration, lanDevice: registration.device ?? stateRef.current.lanDevice, status: 'setupCompleted' });
      } catch (error) {
        if (!(error instanceof Cancelled)) {
          setPhase('hub', 'failed');
          patch({ error: backendFailure(error), status: 'registrationRequired' });
        }
      } finally {
        patch({ busy: false, activity: null });
      }
    },
    [begin, patch, setPhase],
  );

  /** Switches the plug through backend, hub and LAN, and reports what happened. */
  const testControl = useCallback(
    async (on: boolean) => {
      const registration = stateRef.current.registration;
      if (!registration) {
        return;
      }
      patch({ controlTest: { state: 'busy' } });
      try {
        // Either way, only a state the plug confirmed is reported.
        const power =
          registration.target === 'ems'
            ? (await ems.setDevicePower(registration.emsDeviceId, on ? 'on' : 'off')).power
            : (await setDevicePower(registration.cubeSerial, on)).power;
        patch({ controlTest: { state: 'ok', power: power === 'on' || power === 'off' ? power : on ? 'on' : 'off' } });
      } catch (error) {
        patch({ controlTest: { state: 'failed', message: backendFailure(error).message } });
      }
    },
    [patch],
  );

  useEffect(() => {
    actionsRef.current = { scanHotspots, detect, joinHotspot, register };
  }, [detect, joinHotspot, register, scanHotspots]);

  // ---- Navigation -------------------------------------------------------------------

  const retry = useCallback(() => {
    retryRef.current?.();
  }, []);

  /** Returns false on the first page, so the screen itself can go back. */
  const back = useCallback((): boolean => {
    const current = stateRef.current;
    switch (current.step) {
      case 'instructions':
        return false;
      case 'connect':
        stop();
        patch({ step: 'instructions', status: 'waitingForPairing', busy: false, activity: null, error: null });
        return true;
      case 'wifi':
        patch({ step: 'connect', error: null });
        return true;
      case 'progress':
        // Mid-request there is nothing safe to go back to; the resident cancels instead.
        if (SETTLED.includes(current.status)) {
          backToForm();
        }
        return true;
    }
  }, [backToForm, patch, stop]);

  const cancel = useCallback(async () => {
    stop();
    keyRef.current = null;
    await release();
    setState(INITIAL_STATE);
  }, [release, stop]);

  return {
    ...state,
    nativeWifi: isNativeWifiAvailable(),
    canScan: canScanForNetworks(),
    backendConfigured: isBackendConfigured(),
    selectHotspot: (ssid: string) => patch({ selectedHotspot: ssid }),
    markManualJoin,
    backToForm,
    startConnecting,
    scanHotspots,
    joinHotspot,
    detect,
    continueToWifi,
    provisionExperimental,
    skipProvisioning,
    register,
    testControl,
    retry,
    back,
    cancel,
  };
}

export type SonoffPairing = ReturnType<typeof useSonoffPairing>;
