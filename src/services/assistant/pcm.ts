/**
 * PCM helpers for the realtime voice session: the wire format is PCM16,
 * little-endian, mono. Plain TypeScript with no platform imports, so the web
 * and native audio engines share it.
 */

const B64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = (() => {
  const table = new Uint8Array(128).fill(255);
  for (let i = 0; i < B64_ALPHABET.length; i++) {
    table[B64_ALPHABET.charCodeAt(i)] = i;
  }
  // URL-safe variants, in case a proxy ever rewrites the stream.
  table['-'.charCodeAt(0)] = 62;
  table['_'.charCodeAt(0)] = 63;
  return table;
})();

/**
 * Decodes base64 straight into bytes. `atob` would build an intermediate
 * binary string for every 100ms audio delta; this skips that.
 */
export function bytesFromBase64(b64: string): Uint8Array {
  let end = b64.length;
  while (end > 0 && (b64.charCodeAt(end - 1) === 61 /* = */ || b64.charCodeAt(end - 1) <= 32)) {
    end--;
  }
  const out = new Uint8Array(Math.floor((end * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let o = 0;
  for (let i = 0; i < end; i++) {
    const code = b64.charCodeAt(i);
    const value = code < 128 ? B64_LOOKUP[code] : 255;
    if (value === 255) {
      continue; // whitespace or line breaks
    }
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[o++] = (buffer >> bits) & 0xff;
    }
  }
  return o === out.length ? out : out.subarray(0, o);
}

/** Views little-endian PCM16 bytes as samples, copying only when misaligned. */
export function int16FromBytes(bytes: Uint8Array): Int16Array {
  const length = bytes.byteLength >> 1;
  if (bytes.byteOffset % 2 === 0) {
    return new Int16Array(bytes.buffer, bytes.byteOffset, length);
  }
  return new Int16Array(bytes.slice(0, length * 2).buffer);
}

export function float32FromInt16(samples: Int16Array): Float32Array {
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    out[i] = samples[i] / 32768;
  }
  return out;
}

export function int16FromFloat32(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    out[i] = s < 0 ? s * 32768 : s * 32767;
  }
  return out;
}

/**
 * Streams audio from one sample rate to another, carrying its position across
 * chunks so there are no clicks at the joins. Downsampling averages the input
 * samples under each output sample (a box filter, which keeps the worst of
 * the aliasing out of speech); upsampling interpolates linearly.
 */
export class StreamResampler {
  readonly fromRate: number;
  readonly toRate: number;
  private readonly step: number;
  private position = 0;
  private previous = 0;

  constructor(fromRate: number, toRate: number) {
    this.fromRate = fromRate;
    this.toRate = toRate;
    this.step = fromRate / toRate;
  }

  get isPassthrough(): boolean {
    return this.fromRate === this.toRate;
  }

  /** Accepts float (-1..1) or PCM16 samples; returns PCM16 at `toRate`. */
  process(input: Float32Array | Int16Array): Int16Array {
    const scale = input instanceof Int16Array ? 1 / 32768 : 1;
    if (this.isPassthrough) {
      return input instanceof Int16Array ? input : int16FromFloat32(input);
    }

    const out: number[] = [];
    if (this.step > 1) {
      // Downsample: average each window of `step` input samples.
      let pos = this.position;
      while (pos + this.step <= input.length) {
        const start = Math.max(0, Math.floor(pos));
        const stop = Math.min(input.length, Math.floor(pos + this.step));
        let sum = 0;
        for (let i = start; i < stop; i++) {
          sum += input[i] * scale;
        }
        out.push(stop > start ? sum / (stop - start) : 0);
        pos += this.step;
      }
      this.position = pos - input.length;
    } else {
      // Upsample: interpolate between neighbours, the first against the last
      // sample of the previous chunk.
      let pos = this.position;
      while (pos < input.length - 1 + 1e-9) {
        const index = Math.floor(pos);
        const frac = pos - index;
        const a = index < 0 ? this.previous : input[index] * scale;
        const b = index + 1 < input.length ? input[index + 1] * scale : a;
        out.push(a + (b - a) * frac);
        pos += this.step;
      }
      this.position = pos - input.length;
      this.previous = input.length > 0 ? input[input.length - 1] * scale : this.previous;
    }

    return int16FromFloat32(Float32Array.from(out));
  }
}

/** Root-mean-square of a PCM16 window, 0..1. */
export function rmsOf(samples: Int16Array, start = 0, end = samples.length): number {
  const from = Math.max(0, start);
  const to = Math.min(samples.length, end);
  if (to <= from) {
    return 0;
  }
  let sum = 0;
  for (let i = from; i < to; i++) {
    const s = samples[i] / 32768;
    sum += s * s;
  }
  return Math.sqrt(sum / (to - from));
}

/**
 * Maps an RMS amplitude to a 0..1 level that tracks loudness as heard:
 * -55 dBFS (room noise) reads as silence, -12 dBFS (raised voice) as full.
 */
export function levelFromRms(rms: number): number {
  if (rms <= 0) {
    return 0;
  }
  const db = 20 * Math.log10(rms);
  return Math.max(0, Math.min(1, (db + 55) / 43));
}

/** One level per `windowMs` of audio, to animate a visual in step with playback. */
export function levelEnvelope(samples: Int16Array, sampleRate: number, windowMs: number): Float32Array {
  const window = Math.max(1, Math.round((sampleRate * windowMs) / 1000));
  const out = new Float32Array(Math.ceil(samples.length / window));
  for (let w = 0; w < out.length; w++) {
    out[w] = levelFromRms(rmsOf(samples, w * window, (w + 1) * window));
  }
  return out;
}

/** Wraps raw PCM16 mono in a 44-byte WAV header so a media player can open it. */
export function wavFromPcm16(pcm: Uint8Array, sampleRate: number): Uint8Array {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };
  const byteRate = sampleRate * 2;
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, 2, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeAscii(36, 'data');
  view.setUint32(40, pcm.byteLength, true);

  const out = new Uint8Array(44 + pcm.byteLength);
  out.set(new Uint8Array(header), 0);
  out.set(pcm, 44);
  return out;
}

/** Joins byte chunks into one array. */
export function concatBytes(chunks: readonly Uint8Array[], totalLength?: number): Uint8Array {
  const length = totalLength ?? chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const out = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}
