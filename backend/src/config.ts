import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * backend/.env, when present; real environment variables win over it. Not under
 * `node --test` (which sets NODE_TEST_CONTEXT), so a developer's own settings
 * never leak into the tests.
 */
const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile) && !process.env.NODE_TEST_CONTEXT) {
  process.loadEnvFile(envFile);
}

const env = process.env;
const serverRoot = fileURLToPath(new URL('..', import.meta.url));
const dataDir = resolve(serverRoot, env.DATA_DIR || './data');

const trimUrl = (value: string | undefined) => (value ?? '').trim().replace(/\/+$/, '');

const list = (value: string | undefined) =>
  (value ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

/** GATEWAY_PORTS: "18700-18999", the local ports the apartments' gateways listen on (one each, 127.0.0.1 only). */
function portRange(value: string): { first: number; last: number } {
  const match = /^\s*(\d{2,5})\s*-\s*(\d{2,5})\s*$/.exec(value);
  const [first, last] = match ? [Number(match[1]), Number(match[2])] : [0, 0];
  if (!match || first < 1024 || last > 65535 || first > last) {
    throw new Error(`GATEWAY_PORTS must be a range such as 18700-18999, got "${value}".`);
  }
  return { first, last };
}

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
  /**
   * The HTTPS address browsers reach this backend at, e.g. https://api-iot-2.ems-iot.com.
   * Brand sign-in pages (OAuth) return here; those brands stay off until it is set.
   */
  publicUrl: trimUrl(env.PUBLIC_URL),
  /** Where the browser lands after a brand sign-in: the app's own scheme. */
  appReturnUrl: env.APP_RETURN_URL || 'parklane://accounts',
  corsOrigin: env.CORS_ORIGIN || '*',
  dataDir,

  /**
   * Who runs the service, as the public privacy policy (/privacy) and account deletion page
   * (/account/delete) name them. Until the operator and contact are set, /privacy shows a
   * visible "draft" notice: the store listings must not point at it before then.
   */
  legal: {
    /** The legal entity responsible for the app and its data, e.g. a company's registered name. */
    operatorName: (env.LEGAL_OPERATOR_NAME ?? '').trim(),
    /** Where residents send privacy questions and deletion requests. */
    contactEmail: (env.LEGAL_CONTACT_EMAIL ?? '').trim(),
    /** The date the policy text was last changed, shown on the page (YYYY-MM-DD). */
    policyDate: (env.PRIVACY_POLICY_DATE ?? '').trim(),
  },

  /**
   * Weather from MET Norway (api.met.no, CC BY 4.0). Off until WEATHER_CONTACT is set: their terms ask every client
   * to name itself with a way to reach its operator (an email or a web address). The point defaults to the New
   * Administrative Capital; set the compound's own with WEATHER_LAT and WEATHER_LON.
   */
  weather: {
    contact: (env.WEATHER_CONTACT ?? '').trim(),
    lat: Number(env.WEATHER_LAT || 30.02),
    lon: Number(env.WEATHER_LON || 31.76),
  },

  /** EMS accounts. */
  ems: {
    /** 32 bytes, base64. Seals stored secrets. Generated into DATA_DIR when unset. */
    encryptionKey: env.EMS_ENCRYPTION_KEY ?? '',
    /** TRUST_PROXY=1 behind Cloudflare and/or our reverse proxy: ems/rateLimit.ts clientIp says which header counts. */
    trustProxy: env.TRUST_PROXY === '1',
    sessionTtlMs: 30 * 24 * 3600_000,
    /**
     * The ready-made sign-in the backend creates on starting. Set both empty to turn it off.
     * The password is short and known: this account must not hold anything private.
     */
    /** The first admin for the dashboard, made when there is none (ensureAdminAccount); empty password: generated and printed. */
    adminAccount: {
      username: env.EMS_ADMIN_USERNAME ?? 'admin',
      password: env.EMS_ADMIN_PASSWORD ?? '',
    },
    defaultAccount: {
      username: env.EMS_DEFAULT_USERNAME ?? 'ems',
      password: env.EMS_DEFAULT_PASSWORD ?? '5002',
    },
    /** Tokens the app hands the Parklane Assistant (see ems/auth.ts); the app asks for a new one when it lapses. */
    assistantTokenTtlMs: 12 * 3600_000,
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
    /**
     * Optional: a folder of community integrations (each a sub-folder, e.g.
     * sonoff/ from SonoffLAN) copied into every new unit's custom_components.
     */
    customComponents: env.HA_CUSTOM_COMPONENTS ? resolve(serverRoot, env.HA_CUSTOM_COMPONENTS) : '',
    timeZone: env.HA_TIME_ZONE || 'UTC',
    /** Where a separately run hub (POST /api/admin/hubs) may live: CIDRs, e.g. a WireGuard range. */
    allowedNetworks: list(env.HA_ALLOWED_NETWORKS || '100.64.0.0/10'),
    oauthCredentials: oauthCredentials(env.HA_OAUTH_CREDENTIALS),
    /** A command waits this long for the device to report its new state. */
    commandTimeoutMs: Number(env.HA_COMMAND_TIMEOUT_MS || 8_000),
    /** How long a new container gets to answer before provisioning fails. */
    startTimeoutMs: 5 * 60_000,
  },

  /**
   * One CUBE gateway container per unit, made with the unit (ems/gatewayProvisioner.ts) when the relay's enrol token
   * is set. Each runs like gateway/deploy/server-mode/new-apartment.sh starts one without a tunnel box: host network,
   * 127.0.0.1:<port>, enrolled with the relay, linked to its unit.
   */
  gateways: {
    /** CUBE_RELAY_ENROLL_TOKEN from the relay's relay.env. Empty: apartments get no gateway by themselves. */
    relayEnrollToken: env.GATEWAY_RELAY_ENROLL_TOKEN || '',
    relayUrl: trimUrl(env.GATEWAY_RELAY_URL) || 'https://cube-relay.ems-iot.com',
    image: env.GATEWAY_IMAGE || 'hmahmoud2211/cube-os-gateway:latest',
    /** This backend's address as the gateways reach it (member sync): PUBLIC_URL unless set. */
    emsUrl: trimUrl(env.GATEWAY_EMS_URL) || trimUrl(env.PUBLIC_URL),
    ports: portRange(env.GATEWAY_PORTS || '18700-18999'),
    /** The device broker and the shared ReThink, on this host (empty: left out). Same defaults as new-apartment.sh. */
    cloudMqttUrl: env.GATEWAY_CLOUD_MQTT_URL ?? 'mqtt://127.0.0.1:1886',
    rethinkMqttUrl: env.GATEWAY_RETHINK_MQTT_URL ?? 'mqtt://127.0.0.1:1885',
    rethinkApiServer: env.GATEWAY_RETHINK_API_SERVER ?? 'https://lg.ems-iot.com:4443',
    rethinkMqttServer: env.GATEWAY_RETHINK_MQTT_SERVER ?? 'ssl://lg.ems-iot.com:8884',
    /** How long a new gateway gets to check in with this backend and answer through the relay. */
    startTimeoutMs: Number(env.GATEWAY_START_TIMEOUT_MS || 3 * 60_000),
  },

  /** The compound clinic: booking, the doctors' workspace and consultations (see src/clinic/). */
  clinic: {
    /** Doctors' schedules are written in the clinic's own time; appointments are stored in UTC. */
    timezone: env.CLINIC_TIMEZONE || 'Africa/Cairo',
    /** How far ahead residents can book, and how soon before a slot booking closes. */
    bookingHorizonDays: Number(env.CLINIC_BOOKING_HORIZON_DAYS || 30),
    bookingLeadMinutes: Number(env.CLINIC_BOOKING_LEAD_MINUTES || 30),
    /**
     * For testing: residents may book any future minute on any day, outside
     * the doctor's hours and grid. Ignored when NODE_ENV=production.
     */
    anyTimeBooking: env.CLINIC_ANY_TIME_BOOKING === '1' && env.NODE_ENV !== 'production',
    /** Arriving later than this after the slot starts queues the patient by arrival time. */
    lateGraceMinutes: Number(env.CLINIC_LATE_GRACE_MINUTES || 10),
    /** Upcoming appointments one resident may hold at once, across their family. */
    maxUpcomingPerResident: Number(env.CLINIC_MAX_UPCOMING || 6),
    /** Doctors and desk staff sign in on shared clinic machines: shorter sessions than the app's 30 days. */
    staffSessionTtlMs: Number(env.CLINIC_STAFF_SESSION_HOURS || 12) * 3600_000,
    /**
     * Transcripts and the AI's drafts are deleted this long after a consultation
     * is finalized; the approved record is kept. History summaries expire a day
     * after the appointment.
     */
    transcriptRetentionDays: Number(env.CLINIC_TRANSCRIPT_RETENTION_DAYS || 30),
    historySummaryTtlMs: 24 * 3600_000,
    /** Largest recorded segment the browser may upload (about 5 minutes of Opus audio). */
    maxSegmentBytes: 8 * 1024 * 1024,
    /** Notes and transcripts are longer than the default 16 KB body. */
    maxNoteBytes: 512 * 1024,
  },

  /**
   * The AI service for Health Passport (reading documents, spoken summaries)
   * and the clinic (history summaries, consultation notes). Off until its
   * key is set; every call goes from this backend, never from a phone or
   * browser. AI_PROVIDER picks one; left unset, Gemini when its key is set.
   */
  ai: {
    provider: (env.AI_PROVIDER === 'anthropic' || (!env.AI_PROVIDER && !env.GEMINI_API_KEY && env.ANTHROPIC_API_KEY)
      ? 'anthropic'
      : 'gemini') as 'gemini' | 'anthropic',
    timeoutMs: Number(env.AI_TIMEOUT_MS || 180_000),
    gemini: {
      apiKey: env.GEMINI_API_KEY ?? '',
      baseUrl: trimUrl(env.GEMINI_BASE_URL) || 'https://generativelanguage.googleapis.com',
      /** Summaries, notes and spoken handovers. */
      model: env.GEMINI_MODEL || 'gemini-3.8-flash',
      /** Reading photographed and scanned documents; defaults to GEMINI_MODEL. */
      documentModel: env.GEMINI_DOCUMENT_MODEL || env.GEMINI_MODEL || 'gemini-3.8-flash',
      /** low, medium or high (gemini-3.8-flash and gemini-4-argon have no `minimal`). */
      thinkingLevel: env.GEMINI_THINKING_LEVEL || 'medium',
    },
    anthropic: {
      apiKey: env.ANTHROPIC_API_KEY ?? '',
      baseUrl: trimUrl(env.ANTHROPIC_BASE_URL) || 'https://api.anthropic.com',
      model: env.ANTHROPIC_MODEL || 'claude-opus-5-5',
      /** Clinical summarizing is intelligence-sensitive work: `high` rather than the model's `medium` default. */
      effort: env.ANTHROPIC_EFFORT || 'high',
    },
  },

  /** ElevenLabs, for reading summaries aloud and transcribing consultations. Off until ELEVENLABS_API_KEY is set. */
  elevenlabs: {
    apiKey: env.ELEVENLABS_API_KEY ?? '',
    baseUrl: trimUrl(env.ELEVENLABS_BASE_URL) || 'https://api.elevenlabs.io',
    /** eleven_v4 reads Arabic and English, up to 10,000 characters a request. */
    ttsModel: env.ELEVENLABS_TTS_MODEL || 'eleven_v4',
    /** One voice reads both languages unless an Arabic one is given. */
    voiceId: env.ELEVENLABS_VOICE_ID || 'JBFqnCBsd6RMkjVDRZzb',
    voiceIdAr: env.ELEVENLABS_VOICE_ID_AR || '',
    sttModel: env.ELEVENLABS_STT_MODEL || 'scribe_v2',
    /** Sends the patient's documented medicines and conditions as key terms, which helps with drug names (+20% cost). */
    sttKeyterms: env.ELEVENLABS_STT_KEYTERMS !== '0',
    /** `enable_logging=false` (zero retention). ElevenLabs allows it on enterprise plans only. */
    zeroRetention: env.ELEVENLABS_ZERO_RETENTION === '1',
    /** Transcribing a recorded segment (up to about 5 minutes of audio). */
    timeoutMs: Number(env.ELEVENLABS_TIMEOUT_MS || 90_000),
    /** Voicing one part of a summary: a few sentences, so far less than a segment. */
    ttsTimeoutMs: Number(env.ELEVENLABS_TTS_TIMEOUT_MS || 30_000),
  },
} as const;
