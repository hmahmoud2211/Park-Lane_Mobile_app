import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * server/.env, when present; real environment variables win over it. Never
 * under `node --test`: tests set their own stand-ins, and must not pick up a
 * developer's real API keys.
 */
const envFile = new URL('../.env', import.meta.url);
if (existsSync(envFile) && !process.env.NODE_TEST_CONTEXT) {
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

  /** The compound clinic: booking, the doctors' workspace and consultations (see server/src/clinic). */
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
