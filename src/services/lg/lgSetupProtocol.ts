/**
 * The setup an LG appliance takes on its own hotspot, as rethink's
 * rethink-setup.ts performs it (https://github.com/anszom/rethink): the phone
 * joins the appliance's LGE_… network and hands it the home Wi-Fi over TLS.
 * The appliance then joins that Wi-Fi and calls LG's cloud, which the home
 * network's DNS must send to rethink instead.
 *
 * Appliances speak one of three dialects, all tried at once as rethink-setup
 * does: ThinQ1 (framed XML on port 5500, tried first there), ThinQ2 (JSON on
 * port 5500) and Whisen (HTTP on port 9000).
 *
 * The socket is passed in, so this file runs under Node's tests as well as in
 * the app.
 */

export interface SetupSocket {
  write(bytes: Uint8Array): void;
  onData(listener: (bytes: Uint8Array) => void): void;
  /** Called once, when the appliance closes the connection or it fails. */
  onClose(listener: (error?: Error) => void): void;
  destroy(): void;
}

/** Opens a TLS connection to the appliance, without checking its certificate (it is LG's own, self-issued). */
export type OpenSocket = (port: number) => Promise<SetupSocket>;

export type SetupProtocol = 'thinq1' | 'thinq2' | 'whisen';

export interface SetupRequest {
  /** The home network the appliance should join. */
  ssid: string;
  /** Empty for an open network. */
  password: string;
  /** The phone's offset from UTC, east positive, for the appliance's clock. */
  utcOffsetMinutes: number;
  /**
   * Where rethink is, e.g. https://lg.example.com:4443 and ssl://lg.example.com:8884. A ThinQ2
   * appliance given these skips common.lgthinq.com/route, so its network needs no DNS override.
   * ThinQ1 and Whisen setup has no such field.
   */
  servers?: { apiServer: string; mqttServer: string } | null;
}

export type LgSetupErrorKind = 'unreachable' | 'timeout' | 'rejected';

export class LgSetupError extends Error {
  readonly kind: LgSetupErrorKind;

  constructor(kind: LgSetupErrorKind, message: string) {
    super(message);
    this.name = 'LgSetupError';
    this.kind = kind;
  }
}

export const SETUP_PORT = 5500;
export const WHISEN_PORT = 9000;

/** rethink-setup's region values: they point the appliance at the LG hosts rethink answers for. */
const COUNTRY = 'DE';
const THINQ1_REGION = 'rethink';
const THINQ2_REGION = 'eic';
const WHISEN_REGION = 'rethink';

/**
 * Any RSA key will do: the appliance encrypts a reply to it that rethink never
 * reads. rethink's own, byte for byte; the RTL8720 "CLIP" firmware rejects PEM
 * lines with leading whitespace.
 */
const THINQ2_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEApYRAZXRWijMuWNr9LHOJ
fcPcZHDYcO3CwRF9olsPvtJpkrDXR7jEDA6qPHF1jvJ7ArxDLVj8rbkwXb3oXNmN
Sc+n0DPNDiRgghDaDyJpN0qfzmt06MKdihVScwghyYKWD+oA9d1+j3wy3W32he+X
7FnS+yUmmbQ8cT0PYS7p2E8YtbgHrH+SbUzHAgBbaS8E92l7f0qOpQFmYEyP/OX+
1n0dLdXXJ8kFxCLP2n8Wy6XXTutrT0YuZCxabPVYSKsjLh86MuHEM6V8BdBoZItW
qA1bDeDvjP7QC93lGxmwIYR0H8VVQq7gBZYWpPfsRSfwsE/PCMrF1WS4sPnSauaV
QwIDAQAB
-----END PUBLIC KEY-----
`;

// ---- Bytes ---------------------------------------------------------------------------

const encodeUtf8 = (text: string) => new TextEncoder().encode(text);

function decodeUtf8(bytes: ArrayLike<number>): string {
  let escaped = '';
  for (let i = 0; i < bytes.length; i++) {
    escaped += `%${bytes[i].toString(16).padStart(2, '0')}`;
  }
  try {
    return decodeURIComponent(escaped);
  } catch {
    // Not UTF-8: keep the bytes as characters rather than lose the reply.
    let text = '';
    for (let i = 0; i < bytes.length; i++) {
      text += String.fromCharCode(bytes[i]);
    }
    return text;
  }
}

/** SSIDs and passwords go over as base64 of their UTF-8 bytes. */
function base64Utf8(text: string): string {
  let binary = '';
  for (const byte of encodeUtf8(text)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

/** "+0200": sign, two-digit hours, two-digit minutes. */
export function formatUtcOffset(minutes: number): string {
  const sign = minutes < 0 ? '-' : '+';
  const abs = Math.abs(minutes);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}${String(abs % 60).padStart(2, '0')}`;
}

// ---- Framing -------------------------------------------------------------------------

/** CRC-16/XMODEM, the checksum on ThinQ1 frames. */
export function crc16(bytes: ArrayLike<number>): number {
  let crc = 0;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i] << 8;
    for (let bit = 0; bit < 8; bit++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

/** A ThinQ1 frame: 0xaa, 16-bit length, the XML, CRC-16 over all before it, 0xbb. */
export function frameThinq1(xml: string): Uint8Array {
  const payload = encodeUtf8(xml);
  const frame = new Uint8Array(payload.length + 6);
  frame.set([0xaa, payload.length >> 8, payload.length & 0xff]);
  frame.set(payload, 3);
  const crc = crc16(frame.subarray(0, payload.length + 3));
  frame.set([crc >> 8, crc & 0xff, 0xbb], payload.length + 3);
  return frame;
}

/** Splits a byte stream into ThinQ1 frames' XML. Throws on anything else, e.g. a ThinQ2 reply. */
export function thinq1Splitter(onMessage: (xml: string) => void) {
  let pending: number[] = [];
  return (bytes: Uint8Array) => {
    for (const byte of bytes) {
      pending.push(byte);
    }
    while (pending.length >= 3) {
      if (pending[0] !== 0xaa) {
        throw new Error('Not a ThinQ1 frame.');
      }
      const total = ((pending[1] << 8) | pending[2]) + 6;
      if (pending.length < total) {
        return;
      }
      const frame = pending.slice(0, total);
      pending = pending.slice(total);
      // The CRC over the frame including its own CRC is zero.
      if (frame[total - 1] !== 0xbb || crc16(frame.slice(0, total - 1)) !== 0) {
        throw new Error('Damaged ThinQ1 frame.');
      }
      onMessage(decodeUtf8(frame.slice(3, total - 3)));
    }
  };
}

/** Splits a byte stream into the JSON objects ThinQ2 appliances send back to back. */
export function jsonSplitter(onValue: (value: unknown) => void) {
  let buffer: number[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  return (bytes: Uint8Array) => {
    for (const byte of bytes) {
      buffer.push(byte);
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (byte === 0x5c) {
          escaped = true;
        } else if (byte === 0x22) {
          inString = false;
        }
      } else if (byte === 0x22) {
        inString = true;
      } else if (byte === 0x7b || byte === 0x5b) {
        depth++;
      } else if (byte === 0x7d || byte === 0x5d) {
        depth--;
        if (depth < 0) {
          throw new Error('Unbalanced JSON from the appliance.');
        }
        if (depth === 0) {
          const text = decodeUtf8(buffer);
          buffer = [];
          onValue(JSON.parse(text));
        }
      }
    }
  };
}

// ---- Conversations -------------------------------------------------------------------

/**
 * One connection's replies, read one at a time: `next()` waits for the next
 * message, and rejects when the connection closes, a reply cannot be read, or
 * none comes in time.
 */
function conversation<T>(
  socket: SetupSocket,
  split: (onMessage: (message: T) => void) => (bytes: Uint8Array) => void,
  replyTimeoutMs: number,
) {
  const queue: T[] = [];
  let failure: Error | null = null;
  let waiter: { resolve: (message: T) => void; reject: (error: Error) => void } | null = null;

  const fail = (error: Error) => {
    failure ??= error;
    waiter?.reject(failure);
    waiter = null;
  };
  const feed = split((message) => {
    if (waiter) {
      waiter.resolve(message);
      waiter = null;
    } else {
      queue.push(message);
    }
  });
  socket.onData((bytes) => {
    try {
      feed(bytes);
    } catch (error) {
      fail(error instanceof Error ? error : new Error(String(error)));
      socket.destroy();
    }
  });
  socket.onClose((error) => fail(error ?? new Error('The appliance closed the connection.')));

  return {
    next(): Promise<T> {
      const queued = queue.shift();
      if (queued !== undefined) {
        return Promise.resolve(queued);
      }
      if (failure) {
        return Promise.reject(failure);
      }
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          waiter = null;
          reject(new LgSetupError('timeout', 'The appliance stopped answering.'));
        }, replyTimeoutMs);
        waiter = {
          resolve: (message) => {
            clearTimeout(timer);
            resolve(message);
          },
          reject: (error) => {
            clearTimeout(timer);
            reject(error);
          },
        };
      });
    },
  };
}

async function connect(open: OpenSocket, port: number): Promise<SetupSocket> {
  try {
    return await open(port);
  } catch {
    throw new LgSetupError('unreachable', 'The phone could not reach the appliance on its setup network.');
  }
}

/** ThinQ1: one framed XML request per connection, one framed reply. */
async function thinq1Request(open: OpenSocket, xml: string, replyTimeoutMs: number): Promise<string> {
  const socket = await connect(open, SETUP_PORT);
  try {
    const replies = conversation(socket, thinq1Splitter, replyTimeoutMs);
    socket.write(frameThinq1(xml));
    return await replies.next();
  } finally {
    socket.destroy();
  }
}

async function thinq1Setup(open: OpenSocket, request: SetupRequest, replyTimeoutMs: number): Promise<void> {
  await thinq1Request(
    open,
    `<mTosp><data type="deviceinfo"><time>${Date.now()}</time><reg>000</reg><errorCode>N</errorCode></data></mTosp>`,
    replyTimeoutMs,
  );
  await thinq1Request(
    open,
    `<mTosp><data type="apinfo">` +
      `<format>B64</format>` +
      `<bssid>${base64Utf8(request.ssid)}</bssid>` +
      `<security>WPA_PSK</security>` +
      `<password>${base64Utf8(request.password)}</password>` +
      `<subCountryCode>${COUNTRY}</subCountryCode>` +
      `<regionalCode>${THINQ1_REGION}</regionalCode>` +
      `</data></mTosp>`,
    replyTimeoutMs,
  );
}

interface Thinq2Reply {
  type?: string;
  cmd?: string;
  data?: { result?: string };
}

/** ThinQ2: one connection, each request answered before the next. */
async function thinq2Setup(open: OpenSocket, request: SetupRequest, replyTimeoutMs: number): Promise<void> {
  const socket = await connect(open, SETUP_PORT);
  try {
    const replies = conversation<Thinq2Reply>(socket, (onValue) => jsonSplitter((value) => onValue(value as Thinq2Reply)), replyTimeoutMs);
    const send = async (cmd: string, data: Record<string, string>) => {
      socket.write(encodeUtf8(JSON.stringify({ type: 'request', cmd, data })));
      for (;;) {
        const reply = await replies.next();
        if (reply.type !== 'response' || reply.cmd !== cmd) {
          continue;
        }
        if (reply.data?.result && reply.data.result !== '000') {
          throw new LgSetupError('rejected', `The appliance refused ${cmd} (code ${reply.data.result}).`);
        }
        return;
      }
    };

    await send('setDeviceInit', { set: 'true', constantConnect: 'Y' });
    await send('getDeviceInfo', {
      subCountryCode: COUNTRY,
      regionalCode: THINQ2_REGION,
      timezone: formatUtcOffset(request.utcOffsetMinutes),
      publicKey: THINQ2_PUBLIC_KEY,
      constantConnect: 'Y',
      ...(request.servers ? { mqttServer: request.servers.mqttServer, apiServer: request.servers.apiServer } : {}),
    });
    await send('setCertInfo', {
      otp: '0123456789abcdef0123456789abcdef0123456789abcdef',
      svccode: 'SVC202',
      // Some firmware derives the first host it calls from this; OP is LG's production value.
      svcphase: 'OP',
      constantConnect: 'Y',
    });
    await send('setApInfo', {
      format: 'B64',
      ssid: base64Utf8(request.ssid),
      password: base64Utf8(request.password),
      security: 'WPA2_PSK',
      cipher: 'AES',
      constantConnect: 'Y',
    });
    await send('releaseDev', {});
  } finally {
    socket.destroy();
  }
}

/** Whisen: one HTTP/1.1 POST per connection; the reply is everything until the appliance closes. */
async function whisenRequest(
  open: OpenSocket,
  path: string,
  body: string,
  replyTimeoutMs: number,
  headers = [`Content-Length: ${encodeUtf8(body).length}`],
): Promise<string> {
  const socket = await connect(open, WHISEN_PORT);
  return new Promise<string>((resolve, reject) => {
    const chunks: number[] = [];
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new LgSetupError('timeout', 'The appliance stopped answering.'));
    }, replyTimeoutMs);
    socket.onData((bytes) => {
      for (const byte of bytes) {
        chunks.push(byte);
      }
    });
    socket.onClose(() => {
      clearTimeout(timer);
      resolve(decodeUtf8(chunks));
    });
    socket.write(encodeUtf8([`POST ${path} HTTP/1.1`, ...headers, '', body].join('\r\n')));
  });
}

const statusOf = (reply: string) => Number(/^HTTP\/1\.[01] (\d{3})/.exec(reply)?.[1]);

/** Bare JSON members, one per line, as LG's app sends them. */
const members = (fields: Record<string, string>) =>
  Object.entries(fields)
    .map(([key, value]) => `${JSON.stringify(key)}:${JSON.stringify(value)}`)
    .join(',\r\n');

async function whisenSetup(open: OpenSocket, request: SetupRequest, replyTimeoutMs: number): Promise<void> {
  await whisenRequest(open, '/SetDeviceInit', '', replyTimeoutMs);
  // Some firmware answers 500 here; the reply is not needed.
  await whisenRequest(open, '/GetDeviceInfo', '', replyTimeoutMs);
  // Before SetDeviceConfig: ReleaseDevAp at the end takes the hotspot down.
  const info = await whisenRequest(
    open,
    '/SetDeviceInfo',
    `${members({ Nation: COUNTRY, regionalCode: WHISEN_REGION })}\r\n`,
    replyTimeoutMs,
  );
  if (statusOf(info) !== 200) {
    throw new LgSetupError('rejected', 'The appliance refused its region settings.');
  }
  // LG's app declares an empty body here although it sends one; reproduced as is.
  const configReply = await whisenRequest(
    open,
    '/SetDeviceConfig',
    members({ HomeApSSID: request.ssid, HomeApPW: request.password, TimeZone: formatUtcOffset(request.utcOffsetMinutes) }),
    replyTimeoutMs,
    ['Content-Length: 0', 'Session-Id: '],
  );
  if (statusOf(configReply) !== 200) {
    throw new LgSetupError('rejected', 'The appliance refused the Wi-Fi settings and stays in setup mode.');
  }
  await whisenRequest(open, '/ReleaseDevAp', '', replyTimeoutMs);
}

/** The first attempt to succeed, or the most telling failure when all fail. */
function firstSuccess<T>(attempts: Promise<T>[]): Promise<T> {
  const rank: Record<LgSetupErrorKind, number> = { unreachable: 0, timeout: 1, rejected: 2 };
  return new Promise<T>((resolve, reject) => {
    let failed = 0;
    let best: LgSetupError | null = null;
    for (const attempt of attempts) {
      attempt.then(resolve, (error: unknown) => {
        const setupError =
          error instanceof LgSetupError ? error : new LgSetupError('timeout', 'The appliance did not complete setup.');
        if (!best || rank[setupError.kind] > rank[best.kind]) {
          best = setupError;
        }
        if (++failed === attempts.length) {
          reject(best);
        }
      });
    }
  });
}

/**
 * Hands the home Wi-Fi to the appliance. Resolves with the dialect it spoke
 * once it accepted the settings; it then drops its hotspot to join that
 * network. Rejects with an LgSetupError.
 */
export function provisionLgAppliance(
  open: OpenSocket,
  request: SetupRequest,
  replyTimeoutMs: number,
): Promise<SetupProtocol> {
  const thinq = async (): Promise<SetupProtocol> => {
    try {
      // A ThinQ2 appliance rejects the framing or stays silent, then gets JSON.
      await thinq1Setup(open, request, replyTimeoutMs);
      return 'thinq1';
    } catch {
      await thinq2Setup(open, request, replyTimeoutMs);
      return 'thinq2';
    }
  };
  // Whisen appliances listen only on 9000 and ThinQ ones only on 5500, so both run at once.
  const whisen = whisenSetup(open, request, replyTimeoutMs).then((): SetupProtocol => 'whisen');
  return firstSuccess([thinq(), whisen]);
}
