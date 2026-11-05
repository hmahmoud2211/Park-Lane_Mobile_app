/**
 * The audio half of a realtime voice session, implemented per platform:
 * `useVoiceAudio.web.ts` on the browser's Web Audio API, `useVoiceAudio.ts`
 * on expo-audio for iOS and Android. Swapping the native engine (for example
 * to react-native-audio-api) means replacing that one file.
 *
 * `duplex` engines keep the mic open while the assistant talks; the browser's
 * echo cancellation keeps the assistant from hearing itself, so the resident
 * can talk over it. `half-duplex` engines have no echo cancellation (and on
 * iOS cannot record and play at once), so the session pauses the mic while
 * the assistant speaks and the resident interrupts with a tap instead.
 */
export type DuplexMode = 'duplex' | 'half-duplex';

export interface VoiceAudioEngine {
  readonly duplex: DuplexMode;

  /**
   * Called synchronously inside the tap that starts a session: browsers only
   * let audio start from a user gesture.
   */
  prepare(): void;
  /** Asks for the microphone; resolves false if the resident declines. */
  requestPermission(): Promise<boolean>;

  /** Streams PCM16 24 kHz mono chunks of roughly 40-100ms to `onChunk`. */
  startCapture(onChunk: (pcm: ArrayBuffer) => void): Promise<void>;
  stopCapture(): void;
  readonly isCapturing: boolean;

  /** Queues one base64 PCM16 24 kHz delta for gapless playback. */
  enqueuePlayback(base64Pcm: string): void;
  /** The response's audio is complete: play out whatever is still held back. */
  finishPlayback(): void;
  /** Stops playback at once and drops everything queued (barge-in). */
  flushPlayback(): void;
  /** True while audio is playing or waiting to play. */
  readonly isPlaying: boolean;
  /** Fires each time the playback queue runs dry. Returns an unsubscribe. */
  onPlaybackIdle(listener: () => void): () => void;

  /** Microphone loudness now, 0..1. */
  inputLevel(): number;
  /** Assistant loudness now, 0..1, in step with what is heard. */
  outputLevel(): number;

  /** Releases the mic, players and any temporary files. */
  dispose(): void;
}
