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

  /**
   * SONOFF plugs that connect to this backend instead of eWeLink's cloud, so they can be switched
   * from any network (sonoff/cloud.ts). Off until SONOFF_CLOUD_PORT is set.
   */
  sonoffCloud: {
    port: Number(env.SONOFF_CLOUD_PORT || 0),
    /** The name (or IPv4 address) plugs reach this port at: DNS only, not behind Cloudflare's proxy. */
    host: (env.SONOFF_CLOUD_HOST ?? '').trim(),
    /** Any certificate will do; the plug does not check it. */
    certFile: (env.SONOFF_CLOUD_CERT ?? '').trim(),
    keyFile: (env.SONOFF_CLOUD_KEY ?? '').trim(),
    /** Plugs ping every 145 s (the hbInterval they are given); a socket quiet for longer is dropped. */
    idleTimeoutMs: 400_000,
    commandTimeoutMs: 5_000,
  },

  /** LG appliances through rethink (docker/rethink). Off until RETHINK_MQTT_URL is set. */
  rethink: {
    /** The broker rethink publishes to, e.g. mqtt://localhost:1883 or mqtt://user:pass@host:1883. */
    mqttUrl: (env.RETHINK_MQTT_URL ?? '').trim(),
    /** rethink's `rethink_prefix` and `discovery_prefix` (its config.json). */
    prefix: env.RETHINK_PREFIX || 'rethink',
    discoveryPrefix: env.RETHINK_DISCOVERY_PREFIX || 'homeassistant',
    /**
     * rethink's public addresses (its config.json https_port / mqtts_port `advertise`). The app
     * hands them to a ThinQ2 AC while pairing, so the AC reaches rethink from any network without
     * a DNS override. Both or neither, e.g. https://lg.example.com:4443 and ssl://lg.example.com:8884.
     */
    apiServer: trimUrl(env.RETHINK_API_SERVER),
    mqttServer: trimUrl(env.RETHINK_MQTT_SERVER),
    /** How long a power command waits for the appliance to report its new state. */
    confirmMs: 7_500,
  },

  /** EMS accounts, the device registry and the Alexa integration (see ALEXA_INTEGRATION.md). */
  ems: {
    /**
     * The HTTPS address browsers and Amazon reach this backend at, e.g.
     * https://api-iot.ems-iot.com. Account linking stays off until it is set.
     */
    publicUrl: trimUrl(env.EMS_PUBLIC_URL),
    /** 32 bytes, base64. Seals stored Amazon tokens and plug keys. Generated into DATA_DIR when unset. */
    encryptionKey: env.EMS_ENCRYPTION_KEY ?? '',
    /** Set TRUST_PROXY=1 only behind a reverse proxy that overwrites X-Forwarded-For. */
    trustProxy: env.TRUST_PROXY === '1',
    sessionTtlMs: 30 * 24 * 3600_000,
    /** Device commands wait this long for the adapter to confirm. */
    commandTimeoutMs: 8_000,
    /** Shorter for Alexa, which gives the skill about 8 seconds to answer in all. */
    voiceCommandTimeoutMs: 5_000,
  },

  alexa: {
    skillId: env.ALEXA_SKILL_ID ?? '',
    /** `development` until the skill is certified, then `live`. */
    skillStage: env.ALEXA_SKILL_STAGE === 'live' ? 'live' : 'development',
    /** "Alexa Client ID / Secret" from the console's app-to-app linking section; used with Login with Amazon. */
    lwaClientId: env.ALEXA_LWA_CLIENT_ID ?? '',
    lwaClientSecret: env.ALEXA_LWA_CLIENT_SECRET ?? '',
    /** "Your Client ID / Secret" in the skill's account linking; Alexa uses them at /oauth/token. */
    oauthClientId: env.ALEXA_OAUTH_CLIENT_ID ?? '',
    oauthClientSecret: env.ALEXA_OAUTH_CLIENT_SECRET ?? '',
    /** The "Alexa Redirect URLs" the console lists, comma separated: where /oauth/authorize may send codes. */
    redirectUris: (env.ALEXA_REDIRECT_URIS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    /** Where the browser lands after linking: the app's own scheme. */
    appReturnUrl: env.APP_RETURN_URL || 'parklane://alexa-link',
    lwaAuthorizeUrl: env.AMAZON_LWA_AUTHORIZE_URL || 'https://www.amazon.com/ap/oa',
    lwaTokenUrl: env.AMAZON_LWA_TOKEN_URL || 'https://api.amazon.com/auth/o2/token',
    /** Asked for the customer's regional endpoints; the three regions are tried when it fails. */
    apiUrl: trimUrl(env.AMAZON_ALEXA_API_URL) || 'https://api.amazonalexa.com',
    accessTokenTtlS: 3600,
    refreshTokenTtlMs: 365 * 24 * 3600_000,
    /** How often a status request re-asks Amazon whether the skill is still enabled. */
    statusRecheckMs: 60_000,
    /**
     * DEVELOPMENT ONLY. Lets the skill call /api/voice/command before account
     * linking exists, as DEV_VOICE_USER_EMAIL. Refused when NODE_ENV=production.
     */
    devVoiceToken: env.NODE_ENV === 'production' ? '' : (env.DEV_VOICE_TOKEN ?? ''),
    devVoiceUserEmail: env.DEV_VOICE_USER_EMAIL ?? '',
  },
} as const;
