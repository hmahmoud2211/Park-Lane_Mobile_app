import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** server/.env, when present; real environment variables win over it. */
const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

const env = process.env;
const serverRoot = fileURLToPath(new URL('..', import.meta.url));
const dataDir = resolve(serverRoot, env.DATA_DIR || './data');

const list = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

/** HA_OAUTH_CREDENTIALS: {"<integration>": {"clientId": "…", "clientSecret": "…"}}, shared by every unit. */
function oauthCredentials(value: string | undefined): Record<string, { clientId: string; clientSecret: string }> {
  if (!value) {
    return {};
  }
  try {
    return JSON.parse(value) as Record<string, { clientId: string; clientSecret: string }>;
  } catch {
    throw new Error('HA_OAUTH_CREDENTIALS must be JSON: {"<integration>": {"clientId": "…", "clientSecret": "…"}}.');
  }
}

export const config = {
  host: env.HOST || '0.0.0.0',
  port: Number(env.PORT || 8787),
  /** Guards the operations and admin routes. BACKEND_API_KEY is its old name. */
  apiKey: env.ADMIN_API_KEY || env.BACKEND_API_KEY || '',
  corsOrigin: env.CORS_ORIGIN || '*',
  dataDir,

  /** EMS accounts. */
  ems: {
    /** 32 bytes, base64. Seals stored secrets. Generated into DATA_DIR when unset. */
    encryptionKey: env.EMS_ENCRYPTION_KEY ?? '',
    /** Set TRUST_PROXY=1 only behind a reverse proxy that overwrites X-Forwarded-For. */
    trustProxy: env.TRUST_PROXY === '1',
    sessionTtlMs: 30 * 24 * 3600_000,
  },

  /** One Home Assistant container per unit, on this server's Docker (see ha/provisioner.ts). */
  ha: {
    /** Pin a release in production, e.g. ghcr.io/home-assistant/home-assistant:2026.11.0. */
    image: env.HA_IMAGE || 'ghcr.io/home-assistant/home-assistant:stable',
    dockerSocket: env.DOCKER_SOCKET || (process.platform === 'win32' ? '//./pipe/docker_engine' : '/var/run/docker.sock'),
    /** The private Docker network the containers and this backend share. */
    network: env.HA_NETWORK || 'parklane-ha',
    /** Where this backend writes each unit's /config folder… */
    configRoot: env.HA_CONFIG_ROOT ? resolve(serverRoot, env.HA_CONFIG_ROOT) : resolve(dataDir, 'ha'),
    /** …and the same folder as Docker sees it, when the backend itself runs in a container. */
    configHostRoot: env.HA_CONFIG_HOST_ROOT || '',
    /**
     * DEVELOPMENT ONLY: publish each container on a random 127.0.0.1 port, for
     * a backend that runs on the host instead of on the Docker network.
     */
    publishLocalPorts: env.HA_PUBLISH_LOCAL_PORTS === '1',
    memoryMb: Number(env.HA_MEMORY_MB || 512),
    timeZone: env.HA_TIME_ZONE || 'UTC',
    /** Where a separately run hub (POST /api/admin/hubs) may live: CIDRs, e.g. a WireGuard range. */
    allowedNetworks: list(env.HA_ALLOWED_NETWORKS || '100.64.0.0/10'),
    oauthCredentials: oauthCredentials(env.HA_OAUTH_CREDENTIALS),
    /** A command waits this long for the device to report its new state. */
    commandTimeoutMs: Number(env.HA_COMMAND_TIMEOUT_MS || 8_000),
    /** How long a new container gets to answer before provisioning fails. */
    startTimeoutMs: 5 * 60_000,
  },
} as const;
