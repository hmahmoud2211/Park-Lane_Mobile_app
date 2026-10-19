import { Linking, NativeModules, PermissionsAndroid, Platform } from 'react-native';
import WifiManager from 'react-native-wifi-reborn';

import { sonoffConfig } from '../../constants/sonoffConfig';

/**
 * Moves the phone onto a plug's setup hotspot and back, using
 * react-native-wifi-reborn:
 *
 * - Android 10+: a WifiNetworkSpecifier request. The system shows its own
 *   "connect to device" dialog, and the app's traffic is bound to that
 *   network (it has no internet) until `releaseDeviceNetwork` drops it.
 * - iOS: NEHotspotConfiguration for any network starting `ITEAD-`, limited
 *   to this session (joinOnce), after the system's "Join" prompt.
 *
 * The module is native, so it is missing from Expo Go and the web build.
 * Then the resident joins the hotspot in system settings, and the app checks
 * by asking the plug itself (see sonoffDeviceService).
 */

export type WifiErrorKind =
  | 'unavailable'
  | 'permissionDenied'
  | 'locationServicesOff'
  | 'notFound'
  | 'cancelled'
  | 'timeout'
  | 'failed';

export class WifiProvisioningError extends Error {
  readonly kind: WifiErrorKind;

  constructor(kind: WifiErrorKind, message: string) {
    super(message);
    this.name = 'WifiProvisioningError';
    this.kind = kind;
  }
}

/** True in a development or store build with the native module linked. */
export function isNativeWifiAvailable(): boolean {
  return Platform.OS !== 'web' && NativeModules.WifiManager != null;
}

/** Android can list nearby networks; iOS and the web cannot. */
export function canScanForNetworks(): boolean {
  return Platform.OS === 'android' && isNativeWifiAvailable();
}

export function isSetupHotspot(ssid: string | null | undefined): boolean {
  return Boolean(ssid && ssid.toUpperCase().startsWith(sonoffConfig.apSsidPrefix));
}

/** The library rejects with a code string on `error.code`, matching its CONNECT_ERRORS. */
function codeOf(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) {
    return String((error as { code: unknown }).code);
  }
  return '';
}

function toWifiError(error: unknown): WifiProvisioningError {
  switch (codeOf(error)) {
    case 'userDenied':
      return new WifiProvisioningError('cancelled', 'The request to join the device’s network was declined.');
    case 'locationPermissionDenied':
    case 'locationPermissionRestricted':
    case 'locationPermissionMissing':
      return new WifiProvisioningError('permissionDenied', 'Parklane needs location access to find and join Wi-Fi networks.');
    case 'locationServicesOff':
      return new WifiProvisioningError('locationServicesOff', 'Turn on Location so the phone can scan for the device’s network.');
    case 'didNotFindNetwork':
    case 'couldNotDetectSSID':
      return new WifiProvisioningError('notFound', 'The phone could not find the device’s ITEAD- network.');
    case 'timeoutOccurred':
      return new WifiProvisioningError('timeout', 'Joining the device’s network took too long.');
    default:
      return new WifiProvisioningError('failed', 'The phone could not join the device’s network.');
  }
}

/**
 * Android only: location (and, from Android 13, nearby Wi-Fi devices) are
 * required to scan for networks and to read the current network's name.
 */
export async function ensureWifiPermissions(): Promise<void> {
  if (Platform.OS !== 'android') {
    return;
  }
  const { ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION, NEARBY_WIFI_DEVICES } = PermissionsAndroid.PERMISSIONS;
  const wanted = [ACCESS_FINE_LOCATION, ACCESS_COARSE_LOCATION];
  if (typeof Platform.Version === 'number' && Platform.Version >= 33) {
    wanted.push(NEARBY_WIFI_DEVICES);
  }
  const result = await PermissionsAndroid.requestMultiple(wanted);
  if (result[ACCESS_FINE_LOCATION] !== PermissionsAndroid.RESULTS.GRANTED) {
    throw new WifiProvisioningError(
      'permissionDenied',
      'Parklane needs precise location to find the device’s network. Android requires it for Wi-Fi scanning.',
    );
  }
}

export interface NearbyHotspot {
  ssid: string;
  /** Signal strength in dBm. */
  level: number;
}

/**
 * Android only: setup hotspots in range, strongest first. Android allows four
 * scans every two minutes, so a refused rescan falls back to the last results.
 */
export async function scanForSetupHotspots(): Promise<NearbyHotspot[]> {
  if (!canScanForNetworks()) {
    throw new WifiProvisioningError('unavailable', 'This phone cannot list nearby Wi-Fi networks from the app.');
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
  const seen = new Map<string, NearbyHotspot>();
  for (const entry of list) {
    if (isSetupHotspot(entry.SSID) && (seen.get(entry.SSID)?.level ?? -Infinity) < entry.level) {
      seen.set(entry.SSID, { ssid: entry.SSID, level: entry.level });
    }
  }
  return [...seen.values()].sort((a, b) => b.level - a.level);
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

/**
 * The network the phone is on, or null when the platform will not say (no
 * native module, no location permission, or not on Wi-Fi). Never guessed.
 */
export async function getCurrentSsid(): Promise<string | null> {
  if (!isNativeWifiAvailable()) {
    return null;
  }
  const ssid = await withTimeout(WifiManager.getCurrentWifiSSID(), sonoffConfig.ssidTimeoutMs);
  return ssid && ssid !== '<unknown ssid>' ? ssid : null;
}

/**
 * Asks the system to join the plug's hotspot. Resolves once the system says
 * it joined, with the network name when the platform reports it; that is
 * not proof the plug is reachable, which `/device` decides.
 *
 * `ssid` is the exact name (needed on Android). iOS matches the ITEAD- prefix.
 */
export async function connectToDeviceNetwork(ssid?: string): Promise<string | null> {
  if (!isNativeWifiAvailable()) {
    throw new WifiProvisioningError('unavailable', 'Join the device’s network from your phone’s Wi-Fi settings.');
  }
  try {
    if (Platform.OS === 'android') {
      if (!ssid) {
        throw new WifiProvisioningError('notFound', 'Choose the device’s ITEAD- network first.');
      }
      await ensureWifiPermissions();
      await WifiManager.connectToProtectedWifiSSID({
        ssid,
        password: sonoffConfig.apPassword,
        isHidden: false,
        timeout: sonoffConfig.joinTimeoutSeconds,
      });
    } else {
      await WifiManager.connectToProtectedSSIDPrefixOnce(
        sonoffConfig.apSsidPrefix,
        sonoffConfig.apPassword,
        false,
        true,
      );
    }
  } catch (error) {
    throw error instanceof WifiProvisioningError ? error : toWifiError(error);
  }
  return getCurrentSsid();
}

/**
 * Lets the phone go back to its usual Wi-Fi: on Android, drops the network
 * request and the binding to it; on iOS, removes the hotspot configuration.
 * Best effort: when there is nothing to release it does nothing.
 */
export async function releaseDeviceNetwork(ssid: string | null): Promise<void> {
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

/**
 * Android has a Wi-Fi settings screen an app may open. iOS does not: an app
 * can only open its own settings, so there the screen says where to go.
 */
export function canOpenWifiSettings(): boolean {
  return Platform.OS === 'android';
}

/** Resolves false when the settings screen could not be opened. */
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
