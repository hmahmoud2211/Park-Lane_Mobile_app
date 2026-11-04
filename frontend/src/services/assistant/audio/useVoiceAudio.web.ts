import { useEffect, useState } from 'react';

import { assistantConfig } from '../../../constants/assistantConfig';
import {
  StreamResampler,
  bytesFromBase64,
  float32FromInt16,
  int16FromBytes,
  int16FromFloat32,
  levelFromRms,
  rmsOf,
} from '../pcm';
import type { DuplexMode, VoiceAudioEngine } from './voiceAudio.types';

/** Seconds of headroom before the first queued chunk plays. */
const PLAYBACK_LEAD = 0.04;
/** Mic chunk length; the backend asks for 40-100ms. */
const CHUNK_SECONDS = 0.08;
/** How quickly the mic level falls back, per chunk. */
const LEVEL_DECAY = 0.75;

const WORKLET_NAME = 'parklane-pcm-capture';
/**
 * Collects the mic into fixed-length chunks off the main thread, so capture
 * keeps time even while the UI is busy animating.
 */
const WORKLET_SOURCE = `
class PcmCapture extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this.size = options.processorOptions.chunk;
    this.buffer = new Float32Array(this.size);
    this.filled = 0;
  }
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        this.buffer[this.filled++] = channel[i];
        if (this.filled === this.size) {
          this.port.postMessage(this.buffer.slice(0));
          this.filled = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('${WORKLET_NAME}', PcmCapture);
`;

type AudioContextConstructor = typeof AudioContext;

function audioContextClass(): AudioContextConstructor | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return (
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextConstructor }).webkitAudioContext
  );
}

/**
 * Web Audio engine, after the backend's reference client
 * (static/test_voice.html): an echo-cancelled mic resampled to 24 kHz, and
 * deltas scheduled back to back on the audio clock for gapless playback.
 */
class WebVoiceAudio implements VoiceAudioEngine {
  readonly duplex: DuplexMode = 'duplex';

  private context: AudioContext | null = null;
  private workletContext: AudioContext | null = null;
  private media: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private capture: AudioWorkletNode | ScriptProcessorNode | null = null;
  private sink: GainNode | null = null;
  private resampler: StreamResampler | null = null;
  private onChunk: ((pcm: ArrayBuffer) => void) | null = null;
  private micLevel = 0;
  private capturing = false;

  private output: GainNode | null = null;
  private analyser: AnalyserNode | null = null;
  private analyserData: Float32Array<ArrayBuffer> | null = null;
  private readonly sources = new Set<AudioBufferSourceNode>();
  private playhead = 0;
  private readonly idleListeners = new Set<() => void>();

  get isCapturing(): boolean {
    return this.capturing;
  }

  get isPlaying(): boolean {
    return this.sources.size > 0;
  }

  prepare(): void {
    const context = this.ensureContext();
    if (context && context.state === 'suspended') {
      context.resume().catch(() => undefined);
    }
  }

  async requestPermission(): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      return false;
    }
    try {
      await this.ensureMedia();
      return true;
    } catch {
      return false;
    }
  }

  async startCapture(onChunk: (pcm: ArrayBuffer) => void): Promise<void> {
    this.onChunk = onChunk;
    if (this.capturing) {
      return;
    }
    const media = await this.ensureMedia();
    let context = this.ensureContext();
    if (!context) {
      throw new Error('Web Audio is not available in this browser.');
    }

    let source: MediaStreamAudioSourceNode;
    try {
      source = context.createMediaStreamSource(media);
    } catch {
      // Firefox cannot feed a mic into a context running at another rate.
      // Rebuild at the device rate and resample to 24 kHz in script instead.
      this.resetContext();
      context = this.ensureContext(false);
      if (!context) {
        throw new Error('Web Audio is not available in this browser.');
      }
      source = context.createMediaStreamSource(media);
    }
    await context.resume().catch(() => undefined);

    this.resampler =
      context.sampleRate === assistantConfig.sampleRate
        ? null
        : new StreamResampler(context.sampleRate, assistantConfig.sampleRate);

    const chunk = Math.round(context.sampleRate * CHUNK_SECONDS);
    const capture = await this.createCaptureNode(context, chunk);
    // A silent sink keeps the graph pulled without sending the mic to the speaker.
    const sink = context.createGain();
    sink.gain.value = 0;
    source.connect(capture);
    capture.connect(sink);
    sink.connect(context.destination);

    this.source = source;
    this.capture = capture;
    this.sink = sink;
    this.capturing = true;
  }

  stopCapture(): void {
    this.capturing = false;
    this.micLevel = 0;
    if (this.capture) {
      if ('port' in this.capture) {
        this.capture.port.onmessage = null;
        this.capture.port.close();
      } else {
        this.capture.onaudioprocess = null;
      }
      this.capture.disconnect();
    }
    this.source?.disconnect();
    this.sink?.disconnect();
    this.capture = null;
    this.source = null;
    this.sink = null;
    // Releasing the tracks turns off the browser's recording indicator.
    this.media?.getTracks().forEach((track) => track.stop());
    this.media = null;
  }

  enqueuePlayback(base64Pcm: string): void {
    const context = this.context;
    if (!context) {
      return;
    }
    const samples = int16FromBytes(bytesFromBase64(base64Pcm));
    if (samples.length === 0) {
      return;
    }
    const output = this.ensureOutput(context);
    // Buffers keep the wire rate; the context resamples them if it runs faster.
    const buffer = context.createBuffer(1, samples.length, assistantConfig.sampleRate);
    buffer.getChannelData(0).set(float32FromInt16(samples));

    const node = context.createBufferSource();
    node.buffer = buffer;
    node.connect(output);
    const startAt = Math.max(context.currentTime + PLAYBACK_LEAD, this.playhead);
    node.start(startAt);
    this.playhead = startAt + buffer.duration;

    this.sources.add(node);
    node.onended = () => {
      this.sources.delete(node);
      node.disconnect();
      if (this.sources.size === 0) {
        this.emitIdle();
      }
    };
  }

  finishPlayback(): void {
    // Every delta is scheduled as it arrives; nothing is held back.
  }

  flushPlayback(): void {
    const hadAudio = this.sources.size > 0;
    this.sources.forEach((node) => {
      node.onended = null;
      try {
        node.stop();
      } catch {
        // already finished
      }
      node.disconnect();
    });
    this.sources.clear();
    this.playhead = 0;
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
    if (!this.analyser || !this.analyserData || this.sources.size === 0) {
      return 0;
    }
    this.analyser.getFloatTimeDomainData(this.analyserData);
    let sum = 0;
    for (let i = 0; i < this.analyserData.length; i++) {
      sum += this.analyserData[i] * this.analyserData[i];
    }
    return levelFromRms(Math.sqrt(sum / this.analyserData.length));
  }

  dispose(): void {
    this.stopCapture();
    this.flushPlayback();
    this.idleListeners.clear();
    this.resetContext();
  }

  private ensureContext(atWireRate = true): AudioContext | null {
    if (this.context && this.context.state !== 'closed') {
      return this.context;
    }
    const Context = audioContextClass();
    if (!Context) {
      return null;
    }
    try {
      this.context = atWireRate
        ? new Context({ sampleRate: assistantConfig.sampleRate, latencyHint: 'interactive' })
        : new Context({ latencyHint: 'interactive' });
    } catch {
      this.context = new Context();
    }
    return this.context;
  }

  private resetContext(): void {
    this.output = null;
    this.analyser = null;
    this.analyserData = null;
    this.workletContext = null;
    this.context?.close().catch(() => undefined);
    this.context = null;
  }

  private async ensureMedia(): Promise<MediaStream> {
    if (this.media?.active) {
      return this.media;
    }
    this.media = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
    return this.media;
  }

  private async createCaptureNode(
    context: AudioContext,
    chunk: number,
  ): Promise<AudioWorkletNode | ScriptProcessorNode> {
    if (context.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
      try {
        if (this.workletContext !== context) {
          const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: 'application/javascript' }));
          try {
            await context.audioWorklet.addModule(url);
          } finally {
            URL.revokeObjectURL(url);
          }
          this.workletContext = context;
        }
        const node = new AudioWorkletNode(context, WORKLET_NAME, {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          channelCount: 1,
          processorOptions: { chunk },
        });
        node.port.onmessage = (event: MessageEvent<Float32Array>) => this.handleMic(event.data);
        return node;
      } catch {
        // Fall through: some embedded browsers ship Web Audio without worklets.
      }
    }
    const size = [256, 512, 1024, 2048, 4096, 8192].find((s) => s >= chunk) ?? 4096;
    const processor = context.createScriptProcessor(size, 1, 1);
    processor.onaudioprocess = (event) => this.handleMic(event.inputBuffer.getChannelData(0).slice(0));
    return processor;
  }

  private handleMic(frame: Float32Array): void {
    if (!this.capturing) {
      return;
    }
    const pcm = this.resampler ? this.resampler.process(frame) : int16FromFloat32(frame);
    const level = levelFromRms(rmsOf(pcm));
    this.micLevel = Math.max(level, this.micLevel * LEVEL_DECAY);
    this.onChunk?.(pcm.buffer as ArrayBuffer);
  }

  private ensureOutput(context: AudioContext): GainNode {
    if (this.output) {
      return this.output;
    }
    const output = context.createGain();
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    output.connect(analyser);
    analyser.connect(context.destination);
    this.output = output;
    this.analyser = analyser;
    this.analyserData = new Float32Array(analyser.fftSize);
    return output;
  }

  private emitIdle(): void {
    this.playhead = 0;
    this.idleListeners.forEach((listener) => listener());
  }
}

export function useVoiceAudio(): VoiceAudioEngine {
  const [engine] = useState(() => new WebVoiceAudio());
  useEffect(() => () => engine.dispose(), [engine]);
  return engine;
}
