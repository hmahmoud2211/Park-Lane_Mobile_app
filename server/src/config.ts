import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/** server/.env, when present; real environment variables win over it. */
const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const env = process.env;
const serverRoot = new URL('..', import.meta.url).pathname;

function trimUrl(value: string | undefined): string {
  return (value ?? '').trim().replace(/\/+$/, '');
}

export const config = {
  host: env.HOST || '0.0.0.0',
  port: Number(env.PORT || 8787),
  /** How the CUBE hub reaches this backend; empty until set, which blocks registration. */
  publicUrl: trimUrl(env.PUBLIC_URL),
  apiKey: env.BACKEND_API_KEY ?? '',
  corsOrigin: env.CORS_ORIGIN || '*',
  dataDir: resolve(serverRoot, env.DATA_DIR || './data'),

  cube: {
    url: trimUrl(env.CUBE_URL) || 'http://192.168.1.119',
    password: env.CUBE_PASSWORD ?? '',
    token: env.CUBE_TOKEN ?? '',
    /** Recorded on the token the backend asks for. */
    appName: 'parklane-backend',
    timeoutMs: 10_000,
  },

  mdns: {
    interface: env.MDNS_INTERFACE || undefined,
    /** How long one discovery request listens for answers. */
    queryWindowMs: 4_000,
    /** How often registered plugs are looked for, to report state and online changes to the hub. */
    monitorIntervalMs: 30_000,
    /** Missed monitor rounds before a plug is reported offline. */
    offlineAfterMisses: 3,
  },

  lan: {
    /** The hub gives a third-party service 3 seconds to answer a command. */
    commandTimeoutMs: 2_500,
    defaultPort: 8081,
  },
} as const;
