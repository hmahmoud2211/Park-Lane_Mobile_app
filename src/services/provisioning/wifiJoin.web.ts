/**
 * The web build cannot change the computer's Wi-Fi, and a page served over
 * HTTPS cannot call a device on plain HTTP. Setting up a new device needs the
 * phone app; everything here reports that.
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

export const isNativeWifiAvailable = () => false;
export const canJoinInApp = (_transport: 'phone' | 'guided') => false;
export const canScanForNetworks = () => false;
export const canOpenWifiSettings = () => false;

export async function ensureWifiPermissions(): Promise<void> {}

export async function getCurrentSsid(): Promise<string | null> {
  return null;
}

export async function scanForHotspots(_prefixes: readonly string[]): Promise<string[]> {
  throw new WifiJoinError('unavailable', 'Setting up a new device needs the Parklane phone app.');
}

export async function joinHotspot(_options: { ssid?: string | null; prefixes: readonly string[]; password: string | null }): Promise<string | null> {
  throw new WifiJoinError('unavailable', 'Setting up a new device needs the Parklane phone app.');
}

export async function releaseHotspot(_ssid: string | null): Promise<void> {}

export async function openWifiSettings(): Promise<boolean> {
  return false;
}

export async function openAppSettings(): Promise<void> {}

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
