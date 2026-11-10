/**
 * Pairing SONOFF Wi-Fi plugs from their setup hotspot ("Compatible Pairing",
 * or AP mode), and the unit's device backend that adds them to the CUBE hub.
 *
 * The backend (server/ in this repo) holds the hub's credentials, so the app
 * never does for this flow. Point the app at it with
 * EXPO_PUBLIC_DEVICE_BACKEND_URL, e.g. `http://192.168.1.50:8787`, in
 * .env.local. EXPO_PUBLIC_DEVICE_BACKEND_KEY is optional: the backend's
 * BACKEND_API_KEY, if it sets one. Like every EXPO_PUBLIC_ value it ships
 * inside the app, so it only keeps out other devices on the LAN.
 * TODO(auth): replace it with the signed-in resident's token once login is real.
 *
 * In development the URL can be `auto`: the backend on the machine serving
 * this app. A laptop's Wi-Fi address keeps changing, and Expo (on a phone) or
 * the page's own address (in a browser) always knows the current one.
 */
const DEV_BACKEND_PORT = 8787;

function devBackendUrl(): string {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return '';
  const webHost = (globalThis as { location?: { hostname?: string } }).location?.hostname;
  if (webHost) return `http://${webHost}:${DEV_BACKEND_PORT}`;
  // A require, not an import: only a phone in development gets here, and the repo's Node checks load this file.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const Constants = (require('expo-constants') as typeof import('expo-constants')).default;
  const host = Constants.expoConfig?.hostUri?.split(':')[0];
  return host ? `http://${host}:${DEV_BACKEND_PORT}` : '';
}

const configuredUrl = (process.env.EXPO_PUBLIC_DEVICE_BACKEND_URL ?? '').replace(/\/+$/, '');
const backendUrl = configuredUrl === 'auto' ? devBackendUrl() : configuredUrl;

export const sonoffConfig = {
  /** The plug's address on its own hotspot. */
  apBaseUrl: 'http://10.10.7.1',
  /** Every setup hotspot is named ITEAD-<device id>. */
  apSsidPrefix: 'ITEAD-',
  /** ITEAD's published default for the setup hotspot; not a resident's secret. */
  apPassword: '12345678',

  /** One `/device` request; the plug answers in well under a second when it is there. */
  detectTimeoutMs: 4_000,
  detectAttempts: 3,
  detectRetryDelayMs: 1_500,

  /** Android's own wait for the join dialog and the connection. */
  joinTimeoutSeconds: 45,
  /** Reading the current network's name can hang on iOS while it asks for location. */
  ssidTimeoutMs: 4_000,

  /** The experimental `/ap` request: the plug may take a while, or drop the hotspot mid-answer. */
  provisionTimeoutMs: 10_000,
  /** After provisioning: how long to watch for the hotspot to go. */
  hotspotGoneWindowMs: 60_000,
  /** Consecutive failed `/device` checks that count as the hotspot having gone. */
  hotspotGoneMisses: 3,
  hotspotPollMs: 2_500,

  /** Joining home Wi-Fi and announcing itself can take the plug a minute or two. */
  discoveryWindowMs: 150_000,
  discoveryPollMs: 6_000,

  backend: {
    /** Empty when unset; the flow then stops at "Registration required". */
    url: backendUrl,
    apiKey: process.env.EXPO_PUBLIC_DEVICE_BACKEND_KEY ?? '',
    requestTimeoutMs: 10_000,
    /** The backend listens for mDNS announcements for a few seconds per request. */
    discoverTimeoutMs: 15_000,
    registerTimeoutMs: 25_000,
  },
} as const;

/**
 * Where the plug goes after joining Wi-Fi, for the experimental `/ap` request.
 * The plug calls `serverName:port` over HTTPS (`/dispatch/device`) to be told
 * which server to hold its connection with, so this names the service it
 * will talk to. Nothing is chosen for the resident.
 */
export const dispatchServerPresets = [
  {
    id: 'ewelink-us',
    label: 'eWeLink cloud (US)',
    serverName: 'us-dispd.coolkit.cc',
    port: 443,
    /** Captured from the official app's request on firmware 3.5.0 (itead/Sonoff_Devices_DIY_Tools#120). */
    source: 'Seen in the official eWeLink app’s setup request.',
  },
] as const;

export const apProvisioningSources = {
  ewelinkApp: 'https://github.com/itead/Sonoff_Devices_DIY_Tools/issues/120',
  sonotaV4: 'https://github.com/mirko/SonOTA/blob/master/sonota.py',
} as const;
