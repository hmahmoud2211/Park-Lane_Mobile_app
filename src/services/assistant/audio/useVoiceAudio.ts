import {
  createAudioPlayer,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioStream,
  type AudioPlayer,
  type AudioStatus,
  type AudioStream,
  type AudioStreamBuffer,
} from 'expo-audio';
import { File, Paths } from 'expo-file-system';
import { useEffect, useState } from 'react';

import { assistantConfig } from '../../../constants/assistantConfig';
import {
  StreamResampler,
  bytesFromBase64,
  concatBytes,
  int16FromBytes,
  levelEnvelope,
  levelFromRms,
  rmsOf,
  wavFromPcm16,
} from '../pcm';
import type { DuplexMode, VoiceAudioEngine } from './voiceAudio.types';

const BYTES_PER_MS = (assistantConfig.sampleRate * 2) / 1000;
/**
 * Audio held back before the first segment plays. The server streams at about
 * twice real time, so a short wait buys long segments and few joins later.
 */
const FIRST_SEGMENT_MS = 600;
/** The next segment is written and loaded this long before the current one ends. */
const PREPARE_AHEAD_MS = 320;
/** Backstop for a finish event that never arrives. */
const FINISH_GRACE_MS = 900;
const STATUS_INTERVAL_MS = 50;
const LEVEL_WINDOW_MS = 40;
const LEVEL_DECAY = 0.75;
const FILE_PREFIX = 'parklane-voice-';

interface Segment {
  file: File;
  player: AudioPlayer;
  durationMs: number;
  envelope: Float32Array;
  playing: boolean;
  /** Last reported playhead, and when it was reported, for the level meter. */
  positionMs: number;
  positionAt: number;
  subscription?: { remove(): void };
  prepareTimer?: ReturnType<typeof setTimeout>;
  finishTimer?: ReturnType<typeof setTimeout>;
}

/**
 * expo-audio engine for iOS and Android, which runs in Expo Go.
 *
 * Capture is expo-audio's PCM stream. It has no echo cancellation, and on iOS
 * it switches the audio session to record-only, so the engine is half-duplex:
 * the session stops the mic before the assistant speaks, and the engine
 * reopens the session for playback.
 *
 * expo-audio cannot play raw PCM, so playback writes the deltas out as short
 * WAV files and chains a player per file. The next file is loaded while the
 * current one plays, which keeps the joins to a few milliseconds.
 */
class NativeVoiceAudio implements VoiceAudioEngine {
  readonly duplex: DuplexMode = 'half-duplex';

  private stream: AudioStream | null = null;
  private onChunk: ((pcm: ArrayBuffer) => void) | null = null;
  private capturing = false;
  private micLevel = 0;
  private resampler: StreamResampler | null = null;

  private pending: Uint8Array[] = [];
  private pendingBytes = 0;
  private current: Segment | null = null;
  private next: Segment | null = null;
  private responseAudioDone = false;
  private startTimer: ReturnType<typeof setTimeout> | null = null;
  private playbackReady: Promise<void> = Promise.resolve();
  private segmentCount = 0;
  private disposed = false;
  private readonly idleListeners = new Set<() => void>();

  constructor() {
    sweepStaleSegments();
  }

  get isCapturing(): boolean {
    return this.capturing;
  }

  get isPlaying(): boolean {
    return this.current !== null || this.pendingBytes > 0;
  }

  attachStream(stream: AudioStream): void {
    this.stream = stream;
  }

  prepare(): void {
    // Native audio needs no user gesture.
  }

  async requestPermission(): Promise<boolean> {
    const response = await requestRecordingPermissionsAsync();
    return response.granted;
  }

  async startCapture(onChunk: (pcm: ArrayBuffer) => void): Promise<void> {
    this.onChunk = onChunk;
    if (this.capturing || !this.stream || this.disposed) {
      return;
    }
    await setAudioModeAsync({
      allowsRecording: true,
      playsInSilentMode: true,
      interruptionMode: 'doNotMix',
    });
    await this.stream.start();
    this.capturing = true;
  }

  stopCapture(): void {
    if (this.capturing) {
      try {
        this.stream?.stop();
      } catch {
        // already released with its hook
      }
    }
    this.capturing = false;
    this.micLevel = 0;
    // The stream leaves iOS in a record-only session; reopen it for playback
    // before the next segment plays.
    this.playbackReady = setAudioModeAsync({
      allowsRecording: false,
      playsInSilentMode: true,
      interruptionMode: 'doNotMix',
    }).catch(() => undefined);
  }

  handleBuffer(buffer: AudioStreamBuffer): void {
    if (!this.capturing) {
      return;
    }
    let samples: Int16Array = new Int16Array(buffer.data);
    if (buffer.channels === 2) {
      const mono = new Int16Array(samples.length >> 1);
      for (let i = 0; i < mono.length; i++) {
        mono[i] = (samples[2 * i] + samples[2 * i + 1]) >> 1;
      }
      samples = mono;
    }
    // Android falls back to 48/44.1/16 kHz where 24 kHz is unsupported.
    if (buffer.sampleRate !== assistantConfig.sampleRate) {
      if (this.resampler?.fromRate !== buffer.sampleRate) {
        this.resampler = new StreamResampler(buffer.sampleRate, assistantConfig.sampleRate);
      }
      samples = this.resampler.process(samples);
    }
    this.micLevel = Math.max(levelFromRms(rmsOf(samples)), this.micLevel * LEVEL_DECAY);
    // A copy, so the socket gets a plain ArrayBuffer rather than native memory.
    this.onChunk?.(samples.slice().buffer as ArrayBuffer);
  }

  enqueuePlayback(base64Pcm: string): void {
    const bytes = bytesFromBase64(base64Pcm);
    if (bytes.byteLength === 0 || this.disposed) {
      return;
    }
    this.responseAudioDone = false;
    this.pending.push(bytes);
    this.pendingBytes += bytes.byteLength;
    this.pump();
  }

  finishPlayback(): void {
    this.responseAudioDone = true;
    this.pump();
  }

  flushPlayback(): void {
    const hadAudio = this.isPlaying;
    this.clearStartTimer();
    if (this.current) {
      this.release(this.current);
      this.current = null;
    }
    if (this.next) {
      this.release(this.next);
      this.next = null;
    }
    this.pending = [];
    this.pendingBytes = 0;
    this.responseAudioDone = false;
    if (hadAudio) {
      this.emitIdle();
    }
  }

  onPlaybackIdle(listener: () => void): () => void {
    this.idleListeners.add(listener);
    return () => {
      this.idleListeners.delete(listener);
    };
  }

  inputLevel(): number {
    return this.capturing ? this.micLevel : 0;
  }

  outputLevel(): number {
    const segment = this.current;
    if (!segment?.playing) {
      return 0;
    }
    const at = segment.positionMs + (Date.now() - segment.positionAt);
    return segment.envelope[Math.floor(at / LEVEL_WINDOW_MS)] ?? 0;
  }

  dispose(): void {
    this.disposed = true;
    this.stopCapture();
    this.flushPlayback();
    this.idleListeners.clear();
  }

  /** Starts a segment once enough audio has arrived, if none is playing. */
  private pump(): void {
    if (this.current || this.disposed || this.pendingBytes === 0) {
      return;
    }
    if (this.pendingBytes < FIRST_SEGMENT_MS * BYTES_PER_MS && !this.responseAudioDone) {
      // Wait for more, but never hold a short reply back for good.
      if (!this.startTimer) {
        this.startTimer = setTimeout(() => {
          this.startTimer = null;
          if (!this.current && this.pendingBytes > 0) {
            void this.play(this.cutSegment());
          }
        }, FIRST_SEGMENT_MS);
      }
      return;
    }
    this.clearStartTimer();
    void this.play(this.cutSegment());
  }

  /** Writes everything pending to a WAV file and loads a player for it. */
  private cutSegment(): Segment {
    const pcm = concatBytes(this.pending, this.pendingBytes);
    this.pending = [];
    this.pendingBytes = 0;

    const file = new File(Paths.cache, `${FILE_PREFIX}${Date.now()}-${this.segmentCount++}.wav`);
    file.create({ overwrite: true });
    file.write(wavFromPcm16(pcm, assistantConfig.sampleRate));

    const samples = int16FromBytes(pcm);
    return {
      file,
      player: createAudioPlayer(
        { uri: file.uri },
        // Keeps iOS from tearing the session down between segments.
        { updateInterval: STATUS_INTERVAL_MS, keepAudioSessionActive: true },
      ),
      durationMs: (samples.length / assistantConfig.sampleRate) * 1000,
      envelope: levelEnvelope(samples, assistantConfig.sampleRate, LEVEL_WINDOW_MS),
      playing: false,
      positionMs: 0,
      positionAt: Date.now(),
    };
  }

  private async play(segment: Segment): Promise<void> {
    this.current = segment;
    await this.playbackReady;
    if (this.current !== segment) {
      return; // flushed while the session was switching
    }

    segment.subscription = segment.player.addListener(
      'playbackStatusUpdate',
      (status: AudioStatus) => {
        segment.playing = status.playing;
        segment.positionMs = status.currentTime * 1000;
        segment.positionAt = Date.now();
        if (status.didJustFinish) {
          this.endSegment(segment);
        }
      },
    );
    segment.player.play();
    segment.positionAt = Date.now();

    segment.prepareTimer = setTimeout(
      () => this.prepareNext(),
      Math.max(0, segment.durationMs - PREPARE_AHEAD_MS),
    );
    segment.finishTimer = setTimeout(
      () => this.endSegment(segment),
      segment.durationMs + FINISH_GRACE_MS,
    );
  }

  private prepareNext(): void {
    if (!this.next && this.pendingBytes > 0 && !this.disposed) {
      this.next = this.cutSegment();
    }
  }

  private endSegment(segment: Segment): void {
    if (this.current !== segment) {
      return;
    }
    this.release(segment);
    this.current = null;

    let following = this.next;
    this.next = null;
    if (!following && this.pendingBytes > 0) {
      following = this.cutSegment();
    }
    if (following) {
      void this.play(following);
      return;
    }
    this.emitIdle();
  }

  private release(segment: Segment): void {
    clearTimeout(segment.prepareTimer);
    clearTimeout(segment.finishTimer);
    segment.subscription?.remove();
    segment.playing = false;
    try {
      segment.player.pause();
      segment.player.remove();
    } catch {
      // already released
    }
    try {
      segment.file.delete();
    } catch {
      // the system may already have purged the cache
    }
  }

  private clearStartTimer(): void {
    if (this.startTimer) {
      clearTimeout(this.startTimer);
      this.startTimer = null;
    }
  }

  private emitIdle(): void {
    this.idleListeners.forEach((listener) => listener());
  }
}

/** Removes segment files a previous run left behind (e.g. if the app was killed). */
function sweepStaleSegments(): void {
  try {
    for (const entry of Paths.cache.list()) {
      if (entry instanceof File && entry.name.startsWith(FILE_PREFIX)) {
        entry.delete();
      }
    }
  } catch {
    // best effort
  }
}

export function useVoiceAudio(): VoiceAudioEngine {
  const [engine] = useState(() => new NativeVoiceAudio());
  const { stream } = useAudioStream({
    sampleRate: assistantConfig.sampleRate,
    channels: 1,
    encoding: 'int16',
    onBuffer: (buffer) => engine.handleBuffer(buffer),
  });

  useEffect(() => {
    engine.attachStream(stream);
  }, [engine, stream]);

  useEffect(() => () => engine.dispose(), [engine]);

  return engine;
}
