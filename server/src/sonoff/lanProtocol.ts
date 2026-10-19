import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { request } from 'node:http';

import { config } from '../config.ts';

/**
 * The eWeLink LAN protocol, as AlexxIT/SonoffLAN implements it for stock
 * firmware (custom_components/sonoff/core/ewelink/local.py). Not documented
 * by ITEAD for non-DIY devices, so the bridge treats every result as
 * observed rather than assumed:
 *
 * - State arrives in mDNS TXT `data1`..`data4`. On stock firmware it is
 *   AES-128-CBC encrypted (`encrypt=true`, `iv`), keyed with MD5(devicekey).
 *   SonoffLAN documents the `apikey` from `http://10.10.7.1/device` in pairing
 *   mode as that devicekey.
 * - Commands are `POST http://<ip>:8081/zeroconf/<command>` with
 *   `{ sequence, deviceid, selfApikey, data, [encrypt, iv] }`.
 */

const keyOf = (deviceKey: string) => createHash('md5').update(deviceKey, 'utf8').digest();

export function encrypt(data: unknown, deviceKey: string): { data: string; iv: string } {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-128-cbc', keyOf(deviceKey), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return { data: ciphertext.toString('base64'), iv: iv.toString('base64') };
}

/** Throws if the key is wrong: bad padding, or a plaintext that is not JSON. */
export function decrypt(data: string, iv: string, deviceKey: string): unknown {
  const decipher = createDecipheriv('aes-128-cbc', keyOf(deviceKey), Buffer.from(iv, 'base64'));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]);
  // Some firmware pads with stray control bytes after the JSON (SonoffLAN #1160).
  return JSON.parse(plaintext.toString('utf8').replace(/[\x00-\x1f]+$/, ''));
}

export interface DecodedState {
  encrypted: boolean;
  /** true: the key decrypted it. false: it did not. null: nothing needed a key. */
  keyVerified: boolean | null;
  params: Record<string, unknown> | null;
}

/** Reads the state from an announcement's TXT record. */
export function decodeTxt(txt: Record<string, string>, deviceKey?: string): DecodedState {
  const raw = ['data1', 'data2', 'data3', 'data4'].map((field) => txt[field] ?? '').join('');
  const encrypted = txt.encrypt === 'true';
  if (!raw) {
    return { encrypted, keyVerified: null, params: null };
  }
  if (!encrypted) {
    try {
      return { encrypted, keyVerified: null, params: JSON.parse(raw) as Record<string, unknown> };
    } catch {
      return { encrypted, keyVerified: null, params: null };
    }
  }
  if (!deviceKey || !txt.iv) {
    return { encrypted, keyVerified: null, params: null };
  }
  try {
    const params = decrypt(raw, txt.iv, deviceKey);
    return { encrypted, keyVerified: true, params: params as Record<string, unknown> };
  } catch {
    return { encrypted, keyVerified: false, params: null };
  }
}

/** `on`/`off` from a single-channel plug's state; null when it reports something else. */
export function powerOf(params: Record<string, unknown> | null): 'on' | 'off' | null {
  const value = params?.switch;
  return value === 'on' || value === 'off' ? value : null;
}

export type LanResult = 'ok' | 'rejected' | 'timeout' | 'unreachable';

function post(host: string, port: number, path: string, body: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const req = request(
      {
        host,
        port,
        path,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          // The device's server handles one connection at a time.
          Connection: 'close',
        },
        timeout: config.lan.commandTimeoutMs,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('end', () => resolve({ status: response.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
        response.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' })));
    req.on('error', reject);
    req.end(body);
  });
}

/**
 * Sends `{ switch: 'on' | 'off' }` to a single-channel device. A reset
 * connection is retried briefly: the device drops a second connection
 * while it is still busy with the first (SonoffLAN does the same).
 */
export async function sendSwitch(
  target: { host: string; port: number; deviceId: string; deviceKey: string; encrypted: boolean },
  power: 'on' | 'off',
): Promise<LanResult> {
  const params = { switch: power };
  const payload = {
    sequence: String(Date.now()),
    deviceid: target.deviceId,
    selfApikey: '123',
    ...(target.encrypted ? { encrypt: true, ...encrypt(params, target.deviceKey) } : { data: params }),
  };
  const body = JSON.stringify(payload);
  const port = target.port || config.lan.defaultPort;

  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const response = await post(target.host, port, '/zeroconf/switch', body);
      const parsed = JSON.parse(response.body || '{}') as { error?: number };
      return response.status === 200 && parsed.error === 0 ? 'ok' : 'rejected';
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === 'ECONNRESET' && attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        continue;
      }
      if (error instanceof SyntaxError) {
        return 'rejected';
      }
      return code === 'ETIMEDOUT' ? 'timeout' : 'unreachable';
    }
  }
  return 'unreachable';
}
