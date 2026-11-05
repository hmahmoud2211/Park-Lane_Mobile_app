import { config } from '../config.ts';
import { ApiError } from '../errors.ts';
import type { HealthLang } from '../health/passport.ts';
import { log } from '../log.ts';

/**
 * ElevenLabs, for reading a summary aloud (text to speech) and for
 * transcribing a consultation (Scribe speech to text). Only this backend
 * holds ELEVENLABS_API_KEY; browsers send audio and text here.
 *
 * Neither audio nor text is kept: speech is sent back to the doctor's
 * browser part by part, and a recorded segment is dropped once transcribed. Set
 * ELEVENLABS_ZERO_RETENTION=1 on an enterprise plan so ElevenLabs keeps
 * nothing either (`enable_logging=false`).
 */

export const speechConfigured = () => Boolean(config.elevenlabs.apiKey);

function requireConfigured() {
  if (!speechConfigured()) {
    throw new ApiError('not_configured', 'Speech is not set up on this server (ELEVENLABS_API_KEY).');
  }
}

function retentionQuery(): string {
  return config.elevenlabs.zeroRetention ? 'enable_logging=false' : '';
}

/** Arabic, English or the model's own detection. */
export type SpeechLang = HealthLang | 'auto';

/**
 * Summaries are voiced in parts split at sentence ends, never in one long
 * request: the first part is a sentence or two, so a listener hears
 * something within seconds while the rest is made, and each request is
 * short enough to finish well inside its timeout.
 */
const FIRST_PART_CHARS = 160;
const PART_CHARS = 450;
/** Below the model's per-request limit; only a sentence this long without a full stop is cut mid-way. */
const MAX_PART_CHARS = 4_500;
/** ElevenLabs' smallest plans allow two requests at a time. */
const PARALLEL_PARTS = 2;

export function speechParts(text: string): string[] {
  const parts: string[] = [];
  let current = '';
  for (const sentence of text.split(/(?<=[.!?؟\n])\s+/)) {
    const piece = sentence.trim();
    if (!piece) continue;
    const limit = parts.length === 0 ? FIRST_PART_CHARS : PART_CHARS;
    if (current && current.length + 1 + piece.length > limit) {
      parts.push(current);
      current = '';
    }
    current += `${current ? ' ' : ''}${piece}`;
  }
  if (current) parts.push(current);
  return parts.flatMap((part) => (part.length > MAX_PART_CHARS ? part.match(new RegExp(`[\\s\\S]{1,${MAX_PART_CHARS}}`, 'g')) ?? [] : [part]));
}

/** A failure worth one more try: rate limits, overload, a timeout. */
class SpeechBusy extends ApiError {
  constructor() {
    super('speech_failed', 'The speech service is busy or slow right now. Try again.');
  }
}

const BUSY_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

async function requestSpeech(text: string, lang: HealthLang): Promise<Buffer> {
  const voice = lang === 'ar' && config.elevenlabs.voiceIdAr ? config.elevenlabs.voiceIdAr : config.elevenlabs.voiceId;
  const query = ['output_format=mp3_44100_128', retentionQuery()].filter(Boolean).join('&');
  const started = Date.now();
  let response: Response;
  let audio: Buffer;
  try {
    response = await fetch(`${config.elevenlabs.baseUrl}/v1/text-to-speech/${encodeURIComponent(voice)}?${query}`, {
      method: 'POST',
      headers: { 'xi-api-key': config.elevenlabs.apiKey, 'Content-Type': 'application/json', Accept: 'audio/mpeg' },
      body: JSON.stringify({
        text,
        model_id: config.elevenlabs.ttsModel,
        // Multilingual v2 reads the language from the text and refuses a code.
        ...(config.elevenlabs.ttsModel.startsWith('eleven_multilingual') ? {} : { language_code: lang }),
      }),
      signal: AbortSignal.timeout(config.elevenlabs.ttsTimeoutMs),
    });
    audio = response.ok ? Buffer.from(await response.arrayBuffer()) : Buffer.alloc(0);
  } catch (error) {
    const timedOut = (error as Error).name === 'TimeoutError';
    log.warn('Speech synthesis failed to complete', { timedOut, chars: text.length, ms: Date.now() - started });
    throw new SpeechBusy();
  }
  if (!response.ok) {
    log.warn('Speech synthesis refused', { status: response.status, chars: text.length, ms: Date.now() - started });
    if (BUSY_STATUSES.has(response.status)) throw new SpeechBusy();
    throw new ApiError(
      'speech_failed',
      response.status === 401 ? 'The speech service rejected this server’s key.' : 'The speech service could not read this summary. Try again.',
    );
  }
  log.info('Speech part done', { model: config.elevenlabs.ttsModel, lang, chars: text.length, ms: Date.now() - started });
  return audio;
}

/** MP3 audio of one part (see speechParts), in one voice for the language; a busy or slow service gets one more try. */
export async function synthesizePart(text: string, lang: HealthLang): Promise<Buffer> {
  requireConfigured();
  try {
    return await requestSpeech(text, lang);
  } catch (error) {
    if (!(error instanceof SpeechBusy)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    return requestSpeech(text, lang);
  }
}

/** MP3 audio of a whole text: its parts voiced PARALLEL_PARTS at a time and joined in order (MP3 frames join cleanly). */
export async function synthesize(text: string, lang: HealthLang): Promise<Buffer> {
  requireConfigured();
  const parts = speechParts(text);
  const audio: Buffer[] = [];
  let next = 0;
  const worker = async () => {
    while (next < parts.length) {
      const index = next++;
      try {
        audio[index] = await synthesizePart(parts[index], lang);
      } catch (error) {
        next = parts.length; // the other worker stops too
        throw error;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(PARALLEL_PARTS, parts.length) }, worker));
  return Buffer.concat(audio);
}

export interface Utterance {
  speaker: string;
  text: string;
}

export interface Transcription {
  text: string;
  language: string | null;
  utterances: Utterance[];
}

interface ScribeWord {
  text: string;
  type?: 'word' | 'spacing' | 'audio_event';
  speaker_id?: string;
}

/** Consecutive words from one speaker become one utterance. */
export function toUtterances(words: ScribeWord[]): Utterance[] {
  const utterances: Utterance[] = [];
  for (const word of words) {
    if (word.type === 'audio_event') continue;
    const speaker = word.speaker_id ?? 'speaker_0';
    const last = utterances.at(-1);
    if (last && last.speaker === speaker) {
      last.text += word.text;
    } else if (word.type !== 'spacing') {
      utterances.push({ speaker, text: word.text });
    }
  }
  return utterances.map((entry) => ({ ...entry, text: entry.text.trim() })).filter((entry) => entry.text);
}

/**
 * One recorded segment, transcribed with speaker labels. `keyterms` are the
 * patient's documented medicines and conditions, which helps Scribe with
 * drug names it would otherwise mis-hear.
 */
export async function transcribe(
  audio: Buffer,
  mimeType: string,
  options: { lang: SpeechLang; keyterms: string[] },
): Promise<Transcription> {
  requireConfigured();
  const form = new FormData();
  form.append('model_id', config.elevenlabs.sttModel);
  form.append('file', new Blob([new Uint8Array(audio)], { type: mimeType }), `segment.${mimeType.includes('mp4') ? 'mp4' : 'webm'}`);
  if (options.lang !== 'auto') form.append('language_code', options.lang);
  form.append('diarize', 'true');
  form.append('tag_audio_events', 'false');
  form.append('timestamps_granularity', 'word');
  if (config.elevenlabs.sttKeyterms) {
    for (const term of options.keyterms.slice(0, 100)) form.append('keyterms', term);
  }
  const query = retentionQuery();
  let response: Response;
  try {
    response = await fetch(`${config.elevenlabs.baseUrl}/v1/speech-to-text${query ? `?${query}` : ''}`, {
      method: 'POST',
      headers: { 'xi-api-key': config.elevenlabs.apiKey },
      body: form,
      signal: AbortSignal.timeout(config.elevenlabs.timeoutMs),
    });
  } catch (error) {
    log.warn('Transcription failed to complete', { timedOut: (error as Error).name === 'TimeoutError' });
    throw new ApiError('speech_failed', 'Could not reach the transcription service. The segment was kept on this device; try again.');
  }
  if (!response.ok) {
    log.warn('Transcription refused', { status: response.status });
    throw new ApiError(
      'speech_failed',
      response.status === 401 ? 'The transcription service rejected this server’s key.' : 'The transcription service could not process this segment.',
    );
  }
  const body = (await response.json()) as { text?: string; language_code?: string; words?: ScribeWord[] };
  const utterances = toUtterances(body.words ?? []);
  return {
    text: (body.text ?? '').trim(),
    language: body.language_code ?? null,
    utterances: utterances.length ? utterances : body.text?.trim() ? [{ speaker: 'speaker_0', text: body.text.trim() }] : [],
  };
}

/**
 * Words from a patient's record that are worth spelling out for Scribe:
 * each under 50 characters and at most 5 words, without the characters it refuses.
 */
export function keytermsFrom(values: unknown[]): string[] {
  const terms = new Set<string>();
  for (const value of values) {
    if (typeof value !== 'string') continue;
    const term = value.replace(/[<>{}[\]\\]/g, ' ').replace(/\s+/g, ' ').trim();
    if (term.length >= 3 && term.length < 50 && term.split(' ').length <= 5) terms.add(term);
  }
  return [...terms];
}
