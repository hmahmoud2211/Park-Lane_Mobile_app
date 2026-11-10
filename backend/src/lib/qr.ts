/**
 * A small QR code encoder (ISO/IEC 18004): byte mode, error correction level M, versions 1 to 10 (up to 213 bytes),
 * for the visitor's parking pass page. The backend has no packages, so this is written out; test/qr.test.ts checks
 * it module for module against the app's `qrcode` package. It follows the structure of Project Nayuki's reference
 * implementation (MIT): function patterns, Reed-Solomon over GF(256), interleaving, zig-zag placement, masking.
 */

/** Per version (index 1..10) at level M: EC codewords per block, then [blocks, data codewords] for each group. */
const BLOCKS_M: readonly (readonly [number, number, number, number, number])[] = [
  [0, 0, 0, 0, 0],
  [10, 1, 16, 0, 0],
  [16, 1, 28, 0, 0],
  [26, 1, 44, 0, 0],
  [18, 2, 32, 0, 0],
  [24, 2, 43, 0, 0],
  [16, 4, 27, 0, 0],
  [18, 4, 31, 0, 0],
  [22, 2, 38, 2, 39],
  [22, 3, 36, 2, 37],
  [26, 4, 43, 1, 44],
];

const ALIGNMENT: readonly (readonly number[])[] = [[], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34], [6, 22, 38], [6, 24, 42], [6, 26, 46], [6, 28, 50]];

const dataCapacity = (version: number) => {
  const [, b1, d1, b2, d2] = BLOCKS_M[version];
  return b1 * d1 + b2 * d2;
};

function gfMultiply(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i -= 1) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z;
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < result.length; j += 1) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMultiply(root, 0x02);
  }
  return result;
}

function rsRemainder(data: readonly number[], divisor: readonly number[]): number[] {
  const result = divisor.map(() => 0);
  for (const byte of data) {
    const factor = byte ^ (result.shift() as number);
    result.push(0);
    divisor.forEach((coefficient, index) => {
      result[index] ^= gfMultiply(coefficient, factor);
    });
  }
  return result;
}

/** The data codewords: mode, length, bytes, terminator and padding. */
function dataCodewords(bytes: Uint8Array, version: number): number[] {
  const bits: number[] = [];
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
  };
  push(0b0100, 4);
  push(bytes.length, version <= 9 ? 8 : 16);
  for (const byte of bytes) push(byte, 8);
  const capacityBits = dataCapacity(version) * 8;
  push(0, Math.min(4, capacityBits - bits.length));
  push(0, (8 - (bits.length % 8)) % 8);
  const words: number[] = [];
  for (let i = 0; i < bits.length; i += 8) words.push(bits.slice(i, i + 8).reduce((acc, bit) => (acc << 1) | bit, 0));
  for (let pad = 0xec; words.length < dataCapacity(version); pad ^= 0xec ^ 0x11) words.push(pad);
  return words;
}

/** Splits into blocks, adds each block's error correction, and interleaves. */
function withErrorCorrection(data: readonly number[], version: number): number[] {
  const [ecLength, b1, d1, b2, d2] = BLOCKS_M[version];
  const divisor = rsDivisor(ecLength);
  const blocks: { data: number[]; ec: number[] }[] = [];
  let offset = 0;
  for (const [count, size] of [[b1, d1], [b2, d2]] as const) {
    for (let i = 0; i < count; i += 1) {
      const slice = data.slice(offset, offset + size);
      offset += size;
      blocks.push({ data: slice, ec: rsRemainder(slice, divisor) });
    }
  }
  const out: number[] = [];
  const longest = Math.max(...blocks.map((block) => block.data.length));
  for (let i = 0; i < longest; i += 1) for (const block of blocks) if (i < block.data.length) out.push(block.data[i]);
  for (let i = 0; i < ecLength; i += 1) for (const block of blocks) out.push(block.ec[i]);
  return out;
}

const MASKS: readonly ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

class Matrix {
  readonly size: number;
  readonly dark: boolean[][];
  readonly reserved: boolean[][];

  constructor(size: number) {
    this.size = size;
    this.dark = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
    this.reserved = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  }

  set(x: number, y: number, dark: boolean) {
    this.dark[y][x] = dark;
    this.reserved[y][x] = true;
  }
}

function drawFunctionPatterns(m: Matrix, version: number) {
  const size = m.size;
  for (let i = 0; i < size; i += 1) {
    m.set(6, i, i % 2 === 0);
    m.set(i, 6, i % 2 === 0);
  }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const x = cx + dx;
        const y = cy + dy;
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        if (x >= 0 && x < size && y >= 0 && y < size) m.set(x, y, distance !== 2 && distance !== 4);
      }
    }
  }
  const positions = ALIGNMENT[version];
  const last = positions.length - 1;
  positions.forEach((ax, i) =>
    positions.forEach((ay, j) => {
      if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
      for (let dy = -2; dy <= 2; dy += 1) for (let dx = -2; dx <= 2; dx += 1) m.set(ax + dx, ay + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }),
  );
  drawFormat(m, 0);
  if (version >= 7) {
    let remainder = version;
    for (let i = 0; i < 12; i += 1) remainder = (remainder << 1) ^ ((remainder >>> 11) * 0x1f25);
    const bits = (version << 12) | remainder;
    for (let i = 0; i < 18; i += 1) {
      const dark = ((bits >>> i) & 1) === 1;
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      m.set(a, b, dark);
      m.set(b, a, dark);
    }
  }
}

/** Format information: level M (00) and the mask, with its BCH code, twice. */
function drawFormat(m: Matrix, mask: number) {
  const data = (0b00 << 3) | mask;
  let remainder = data;
  for (let i = 0; i < 10; i += 1) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  const bits = ((data << 10) | remainder) ^ 0x5412;
  const bit = (i: number) => ((bits >>> i) & 1) === 1;
  const size = m.size;
  for (let i = 0; i <= 5; i += 1) m.set(8, i, bit(i));
  m.set(8, 7, bit(6));
  m.set(8, 8, bit(7));
  m.set(7, 8, bit(8));
  for (let i = 9; i < 15; i += 1) m.set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i += 1) m.set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i += 1) m.set(8, size - 15 + i, bit(i));
  m.set(8, size - 8, true);
}

function placeCodewords(m: Matrix, codewords: readonly number[]) {
  const size = m.size;
  let index = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical += 1) {
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vertical : vertical;
        if (!m.reserved[y][x] && index < codewords.length * 8) {
          m.dark[y][x] = ((codewords[index >>> 3] >>> (7 - (index & 7))) & 1) === 1;
          index += 1;
        }
      }
    }
  }
}

function applyMask(m: Matrix, mask: number) {
  for (let y = 0; y < m.size; y += 1) for (let x = 0; x < m.size; x += 1) if (!m.reserved[y][x] && MASKS[mask](x, y)) m.dark[y][x] = !m.dark[y][x];
}

/** The standard's penalty score; the lowest-scoring mask is used. */
function penalty(dark: boolean[][]): number {
  const size = dark.length;
  let score = 0;
  const lines = [...dark, ...dark[0].map((_, x) => dark.map((row) => row[x]))];
  for (const line of lines) {
    let run = 1;
    for (let i = 1; i <= size; i += 1) {
      if (i < size && line[i] === line[i - 1]) run += 1;
      else {
        if (run >= 5) score += 3 + (run - 5);
        run = 1;
      }
    }
    const text = line.map((cell) => (cell ? '1' : '0')).join('');
    for (const pattern of ['10111010000', '00001011101']) {
      for (let at = text.indexOf(pattern); at !== -1; at = text.indexOf(pattern, at + 1)) score += 40;
    }
  }
  for (let y = 0; y < size - 1; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      const c = dark[y][x];
      if (c === dark[y][x + 1] && c === dark[y + 1][x] && c === dark[y + 1][x + 1]) score += 3;
    }
  }
  const total = dark.reduce((sum, row) => sum + row.filter(Boolean).length, 0);
  score += Math.floor(Math.abs((total * 100) / (size * size) - 50) / 5) * 10;
  return score;
}

export interface QrCode {
  version: number;
  mask: number;
  size: number;
  /** Rows of modules, true for dark. */
  modules: boolean[][];
}

/** Encodes text (UTF-8) as a QR code; `mask` forces a mask pattern (tests). */
export function encodeQr(text: string, options: { mask?: number } = {}): QrCode {
  const bytes = new TextEncoder().encode(text);
  let version = 1;
  while (version <= 10 && bytes.length + (version <= 9 ? 2 : 3) > dataCapacity(version)) version += 1;
  if (version > 10) throw new Error('Too long for a QR code here (213 bytes at most).');
  const codewords = withErrorCorrection(dataCodewords(bytes, version), version);
  const build = (mask: number) => {
    const m = new Matrix(version * 4 + 17);
    drawFunctionPatterns(m, version);
    placeCodewords(m, codewords);
    applyMask(m, mask);
    drawFormat(m, mask);
    return m;
  };
  let best = options.mask ?? 0;
  if (options.mask === undefined) {
    let bestScore = Infinity;
    for (let mask = 0; mask < 8; mask += 1) {
      const score = penalty(build(mask).dark);
      if (score < bestScore) {
        bestScore = score;
        best = mask;
      }
    }
  }
  const m = build(best);
  return { version, mask: best, size: m.size, modules: m.dark };
}

/** The dark modules as one SVG path (a 4-module quiet zone around it): `<path d="…">` in a viewBox of size + 8. */
export function qrSvgPath(code: QrCode): string {
  const parts: string[] = [];
  code.modules.forEach((row, y) => row.forEach((dark, x) => dark && parts.push(`M${x + 4} ${y + 4}h1v1h-1z`)));
  return parts.join('');
}
