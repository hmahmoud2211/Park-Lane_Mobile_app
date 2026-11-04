import { Linking, NativeModules, PermissionsAndroid, Platform, type Permission } from 'react-native';
import WifiManager from 'react-native-wifi-reborn';

/**
 * Moving the phone onto a device's setup hotspot and back, with
 * react-native-wifi-reborn:
 *
 * - Android 10+: a WifiNetworkSpecifier request. The system shows its own
 *   "connect to device" dialog and binds this app's traffic to that network
 *   (it has no internet) until `releaseHotspot` drops it. Other apps, such as
 *   the browser, keep using the normal network.
 * - iOS: NEHotspotConfiguration, limited to this session (joinOnce), after
 *   the system's "Join" prompt. The whole phone moves to the hotspot.
 *
 * Because an Android in-app join is invisible to the browser, a setup that
 * opens the device's own web page (guided) is joined from Wi-Fi settings on
 * Android instead. The native module is missing from Expo Go and the web
 * build; the resident then joins in system settings and the app checks by
 * asking the device itself (`waitForDevice`).
 */

export type WifiErrorKind =
  | 'unavailable'
  | 'permissionDenied'
  | 'locationServicesOff'
  | 'notFound'
  | 'cancelled'
  | 'wrongPassword'
  | 'timeout'
  | 'failed';

export class WifiJoinError extends Error {
  readonly kind: WifiErrorKind;

  constructor(kind: WifiErrorKind, message: string) {
    super(message);
    this.name = 'WifiJoinError';
    this.kind = kind;
  }
}

const JOIN_TIMEOUT_SECONDS = 45;
/** Reading the current network's name can hang on iOS while it asks for location. */
const SSID_TIMEOUT_MS = 4_000;

export function isNativeWifiAvailable(): boolean {
  return Platform.OS !== 'web' && NativeModules.WifiManager != null;
}

/**
 * Whether the app can join the hotspot itself for this kind of setup. A guided
 * setup opens the device's page in the browser, which on Android only sees a
 * network joined from Wi-Fi settings.
 */
export function canJoinInApp(transport: 'phone' | 'guided'): boolean {
  return isNativeWifiAvailable() && (Platform.OS === 'ios' || transport === 'phone');
}

export function canScanForNetworks(): boolean {
  return Platform.OS === 'android' && isNativeWifiAvailable();
}

function codeOf(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    return String((error as { code: unknown }).code);
  }
  return '';
}

function toWifiError(error: unknown): WifiJoinError {
  switch (codeOf(error)) {
    case 'userDenied':
      return new WifiJoinError('cancelled', 'The request to join the device’s network was declined.');
    case 'locationPermissionDenied':
    case 'locationPermissionRestricted':
    case 'locationPermissionMissing':
      return new WifiJoinError('permissionDenied', 'The app needs location access to find and join Wi-Fi networks.');
    case 'locationServicesOff':
      return new WifiJoinError('locationServicesOff', 'Turn on Location so the phone can scan for the device’s network.');
    case 'didNotFindNetwork':
    case 'couldNotDetectSSID':
      return new WifiJoinError('notFound', 'The phone could not find the device’s network. Is the device still in setup mode?');
    case 'authenticationErrorOccurred':
    case 'invalidPassphrase':
      return new WifiJoinError('wrongPassword', 'The device’s network rejected the password.');
    case 'timeoutOccurred':
      return new WifiJoinError('timeout', 'Joining the device’s network took too long.');
    default:
      return new WifiJoinError('failed', 'The phone could not join the device’s network.');
  }
}

/** Android: location (and, from Android 13, nearby Wi-Fi devices) to scan for networks and read the current one. */
export async function ensureWifiPermissions(): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }
  const { ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION, NEARBY_WIFI_DEVICES } = PermissionsAndroid.PERMISSIONS;
  const wanted: Permission[] = [ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION];
  if (typeof Platform.Version === 'number' && Platform.Version >= 33) {
    wanted.push(NEARBY_WIFI_DEVICES);
  }
  const result = await PermissionsAndroid.requestMultiple(wanted);
  if (result[ACCESS_FINE_LOCATION] !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new WifiJoinError('permissionDenied', 'Allow precise location: Android requires it for Wi-Fi scanning.');
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(null);
      },
    );
  });
}

/** The network the phone is on, or null when the platform will not say. Never guessed. */
export async function getCurrentSsid(): Promise<string | null> {
  if (!isNativeWifiAvailable()) {
    return null;
  }
  const ssid = await withTimeout(WifiManager.getCurrentWifiSSID(), SSID_TIMEOUT_MS);
  return ssid && ssid !== '<unknown ssid>' ? ssid : null;
}

const matches = (ssid: string, prefixes: readonly string[]) => prefixes.some((prefix) => ssid.toLowerCase().startsWith(prefix.toLowerCase()));

/** Android: setup hotspots in range, strongest first. Android allows four scans every two minutes. */
export async function scanForHotspots(prefixes: readonly string[]): Promise<string[]> {
  if (!canScanForNetworks()) {
    throw new WifiJoinError('unavailable', 'This phone cannot list nearby Wi-Fi networks from the app.');
  }
  await ensureWifiPermissions();
  let list: Awaited<ReturnType<typeof WifiManager.loadWifiList>>;
  try {
    list = await WifiManager.reScanAndLoadWifiList();
  } catch (error) {
    if (codeOf(error) === 'locationServicesOff') {
      throw toWifiError(error);
    }
    try {
      list = await WifiManager.loadWifiList();
    } catch (fallbackError) {
      throw toWifiError(fallbackError);
    }
  }
  const strongest = new Map<string, number>();
  for (const entry of list) {
    if (entry.SSID && matches(entry.SSID, prefixes) && (strongest.get(entry.SSID) ?? -Infinity) < entry.level) {
      strongest.set(entry.SSID, entry.level);
    }
  }
  return [...strongest.entries()].sort((a, b) => b[1] - a[1]).map(([ssid]) => ssid);
}

/**
 * Asks the system to join the device's hotspot. `ssid` is the exact name
 * (needed on Android, found by scanning when omitted); iOS can match a prefix.
 * Resolves with the joined name when the platform reports it. Joining is not
 * proof the device is reachable: `waitForDevice` decides that.
 */
export async function joinHotspot(options: { ssid?: string | null; prefixes: readonly string[]; password: string | null }): Promise<string | null> {
  if (!isNativeWifiAvailable()) {
    throw new WifiJoinError('unavailable', 'Join the device’s network from your phone’s Wi-Fi settings.');
  }
  const password = options.password ? options.password : null;
  try {
    if (Platform.OS === 'android') {
      await ensureWifiPermissions();
      const ssid = options.ssid ?? (await scanForHotspots(options.prefixes))[0];
      if (!ssid) {
        throw new WifiJoinError('notFound', 'No setup network found nearby. Check the device is in setup mode and close to the phone.');
      }
      await WifiManager.connectToProtectedWifiSSID({ ssid, password, isHidden: false, timeout: JOIN_TIMEOUT_SECONDS });
      return ssid;
    }
    const prefix = options.ssid ?? options.prefixes[0];
    if (!prefix) {
      throw new WifiJoinError('notFound', 'Enter the device’s network name.');
    }
    if (options.ssid) {
      await WifiManager.connectToProtectedSSIDOnce(options.ssid, password, false, true);
    } else {
      await WifiManager.connectToProtectedSSIDPrefixOnce(prefix, password, false, true);
    }
  } catch (error) {
    throw error instanceof WifiJoinError ? error : toWifiError(error);
  }
  return getCurrentSsid();
}

/** Back to the usual Wi-Fi: drops the Android network request and binding, or the iOS hotspot configuration. */
export async function releaseHotspot(ssid: string | null): Promise<void> {
  if (!isNativeWifiAvailable()) {
    return;
  }
  try {
    if (Platform.OS === 'android') {
      await WifiManager.disconnect();
    } else if (ssid) {
      await WifiManager.disconnectFromSSID(ssid);
    }
  } catch {
    // Already off the hotspot.
  }
}

/** Android has a Wi-Fi settings screen an app may open; iOS only lets an app open its own settings. */
export function canOpenWifiSettings(): boolean {
  return Platform.OS === 'android';
}

export async function openWifiSettings(): Promise<boolean> {
  if (!canOpenWifiSettings()) {
    return false;
  }
  try {
    await Linking.sendIntent('android.settings.WIFI_SETTINGS');
    return true;
  } catch {
    return false;
  }
}

/** The app's own settings page, e.g. to allow Local Network access on iOS. */
export async function openAppSettings(): Promise<void> {
  await Linking.openSettings().catch(() => undefined);
}

/**
 * Asks `probe` again and again until it answers truthy, the time is up, or
 * `signal` aborts. Used to notice the phone has reached the device's network
 * (whichever way it joined) and to wait for a device to come back.
 */
export async function waitForDevice<T>(
  probe: () => Promise<T | null>,
  options: { timeoutMs: number; intervalMs?: number; signal?: AbortSignal },
): Promise<T | null> {
  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline && !options.signal?.aborted) {
    const result = await probe().catch(() => null);
    if (result) {
      return result;
    }
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs ?? 2_000));
  }
  return null;
}
