import { cbc } from '@noble/ciphers/aes.js';
import { p256 } from '@noble/curves/nist.js';
import { md5 } from '@noble/hashes/legacy.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

/**
 * The cryptography of Meross's setup protocol, with no React Native imports so
 * it can be checked against Node's crypto (the same primitives the bytespider/Meross
 * tool uses). MD5 and the fixed IV are Meross's protocol, not choices made here.
 *
 * - Requests are signed with md5(messageId + key + timestamp).
 * - Newer firmware runs an ECDH exchange on P-256, then encrypts every request and
 *   answer with AES-256-CBC, zero padded; the key is the md5 hex text of the shared
 *   secret's x coordinate.
 * - WifiX firmware takes the Wi-Fi password encrypted the same way, with the key
 *   md5(type + uuid + mac) as text.
 */

const IV = utf8ToBytes('0000000000000000');
const BLOCK = 16;
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export const md5Hex = (data: string | Uint8Array): string => bytesToHex(md5(typeof data === 'string' ? utf8ToBytes(data) : data));

export function sign(messageId: string, key: string, timestamp: number): string {
  return md5Hex(`${messageId}${key}${timestamp}`);
}

export function toBase64(bytes: Uint8Array): string {
  let out = '';
  for (let index = 0; index < bytes.length; index += 3) {
    const chunk = (bytes[index] << 16) | ((bytes[index + 1] ?? 0) << 8) | (bytes[index + 2] ?? 0);
    out += B64[(chunk >> 18) & 63] + B64[(chunk >> 12) & 63];
    out += index + 1 < bytes.length ? B64[(chunk >> 6) & 63] : '=';
    out += index + 2 < bytes.length ? B64[chunk & 63] : '=';
  }
  return out;
}

export function fromBase64(text: string): Uint8Array {
  const bytes: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const char of text.replace(/=+$/, '')) {
    const value = B64.indexOf(char);
    if (value < 0) {
      throw new Error('invalid base64');
    }
    buffer = ((buffer << 6) | value) & 0xffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >> bits) & 0xff);
    }
  }
  return Uint8Array.from(bytes);
}

export function encrypt(data: Uint8Array, key: Uint8Array): Uint8Array {
  // Always pads, by a whole block when the data is already a multiple of 16, as the firmware expects.
  const padded = new Uint8Array(data.length + (BLOCK - (data.length % BLOCK)));
  padded.set(data);
  return cbc(key, IV, { disablePadding: true }).encrypt(padded);
}

export function decrypt(data: Uint8Array, key: Uint8Array): Uint8Array {
  const plain = cbc(key, IV, { disablePadding: true }).decrypt(data);
  let end = plain.length;
  while (end > 0 && plain[end - 1] === 0) {
    end -= 1;
  }
  return plain.subarray(0, end);
}

/** The private key the official flow derives from the device and the signing key; 32 bytes of hex text. */
export function devicePrivateKey(uuid: string, key: string, mac: string): Uint8Array {
  return utf8ToBytes(md5Hex(`${uuid.slice(3, 22)}${key.slice(1, 9)}${mac}${key.slice(10, 28)}`));
}

/** Our uncompressed public key, as the device takes it. */
export function publicKeyOf(privateKey: Uint8Array): Uint8Array {
  return p256.getPublicKey(privateKey, false);
}

/** The session key: the md5 hex text of the shared secret's x coordinate. */
export function sharedSessionKey(privateKey: Uint8Array, remotePublicKey: Uint8Array): Uint8Array {
  const x = p256.getSharedSecret(privateKey, remotePublicKey, true).subarray(1);
  return utf8ToBytes(md5Hex(x));
}

export function encryptWifiPassword(password: string, device: { type: string; uuid: string; mac: string }): Uint8Array {
  return encrypt(utf8ToBytes(password), utf8ToBytes(md5Hex(`${device.type}${device.uuid}${device.mac}`)));
}

export { utf8ToBytes };
