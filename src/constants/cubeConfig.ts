import { Platform } from 'react-native';

/**
 * The unit's eWeLink CUBE hub, reached over the LAN through its Open API
 * (https://cube.ewelink.cc/resources/developer-and-api-guide).
 *
 * Override per build with EXPO_PUBLIC_CUBE_URL and EXPO_PUBLIC_CUBE_PASSWORD
 * (kept in .env.local, which git ignores). The password is the one for the
 * CUBE web console; the app uses it to approve its own Open API token, which
 * on the Docker build stands in for pressing the hub's link button.
 *
 * The hub sends no CORS headers, so the web build calls it through the dev
 * server's `/cube` proxy (metro.config.js) rather than directly.
 */
const DEFAULT_CUBE_URL = 'http://192.168.1.119';

const hubUrl = (process.env.EXPO_PUBLIC_CUBE_URL ?? DEFAULT_CUBE_URL).replace(/\/+$/, '');

export const cubeConfig = {
  /** The hub itself, e.g. for opening its web console. */
  hubUrl,
  /** Where requests go: the hub, or the same-origin proxy on web. */
  httpBase: Platform.OS === 'web' ? '/cube' : hubUrl,
  password: process.env.EXPO_PUBLIC_CUBE_PASSWORD ?? '',
  /** Recorded on the token and on every device added through it. */
  appName: 'parklane',

  requestTimeoutMs: 10_000,
  /** Adding a camera makes the hub open its stream first, which can be slow. */
  addCameraTimeoutMs: 30_000,
  /** The hub stops searching for Zigbee devices on its own after this long. */
  pairingSeconds: 180,
  /** How often the device list is re-read while pairing. */
  pairingPollMs: 3_000,
} as const;
