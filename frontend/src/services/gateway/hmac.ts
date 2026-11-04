import * as Crypto from 'expo-crypto';

/**
 * The gateway's identity proof, checked before the phone sends its token to
 * an address it has not used before (a new IP after DHCP, a gateway found by
 * scanning). Anything can answer on port 8686 and call itself a CUBE Gateway;
 * only the real one holds this phone's pin_key.
 *
 *   proof = hex(HMAC-SHA256(pin_key, "cube-gw-v1|" + gateway_id + "|" + nonce))
 *
 * Mirrors identity_proof() in gateway/cube_gateway/crypto.py. expo-crypto has
 * no HMAC, so it is built from two SHA-256 digests (RFC 2104). pin_key comes
 * from the gateway as base64url without padding (security.encode_key).
 */

const BLOCK_SIZE = 64;
const PROOF_PREFIX = 'cube-gw-v1';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** base64url (or standard base64) without padding → bytes. */
export function decodeBase64Url(value: string): Uint8Array {
  const clean = value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of clean) {
    const index = B64.indexOf(char);
    if (index < 0) {
      throw new Error('invalid base64url');
    }
    buffer = (buffer << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(bytes);
}

const toHex = (bytes: Uint8Array) => Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

async function sha256(data: Uint8Array): Promise<Uint8Array> {
  // A fresh ArrayBuffer-backed copy: digest() takes BufferSource, which excludes SharedArrayBuffer views.
  const copy = new Uint8Array(new ArrayBuffer(data.length));
  copy.set(data);
  return new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, copy));
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

export async function hmacSha256(key: Uint8Array, message: Uint8Array): Promise<Uint8Array> {
  let block = key.length > BLOCK_SIZE ? await sha256(key) : key;
  if (block.length < BLOCK_SIZE) {
    const padded = new Uint8Array(BLOCK_SIZE);
    padded.set(block);
    block = padded;
  }
  const inner = block.map((byte) => byte ^ 0x36);
  const outer = block.map((byte) => byte ^ 0x5c);
  return sha256(concat(outer, await sha256(concat(inner, message))));
}

export async function identityProof(pinKey: string, gatewayId: string, nonce: string): Promise<string> {
  const message = new TextEncoder().encode(`${PROOF_PREFIX}|${gatewayId}|${nonce}`);
  return toHex(await hmacSha256(decodeBase64Url(pinKey), message));
}

export const newNonce = () => toHex(Crypto.getRandomBytes(16));

/** Compares without stopping at the first difference. */
export function sameProof(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return difference === 0;
}
