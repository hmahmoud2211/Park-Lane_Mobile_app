import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { config } from '../config.ts';

/**
 * Sealing for values the backend must read back (such as hub tokens), and
 * hashing for values it only compares (EMS tokens).
 *
 * The AES-256-GCM key comes from EMS_ENCRYPTION_KEY. Without it, one is
 * generated into DATA_DIR/ems.key (mode 600) so a development backend works
 * out of the box; production should set the variable from a secrets manager.
 */

let key: Buffer | null = null;

function sealingKey(): Buffer {
  if (key) {
    return key;
  }
  if (config.ems.encryptionKey) {
    const given = Buffer.from(config.ems.encryptionKey, 'base64');
    if (given.length !== 32) {
      throw new Error('EMS_ENCRYPTION_KEY must be 32 bytes, base64 encoded.');
    }
    key = given;
    return key;
  }
  const file = join(config.dataDir, 'ems.key');
  if (!existsSync(file)) {
    mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
    writeFileSync(file, randomBytes(32).toString('base64'), { mode: 0o600 });
  }
  chmodSync(file, 0o600);
  key = Buffer.from(readFileSync(file, 'utf8').trim(), 'base64');
  return key;
}

export function seal(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', sealingKey(), iv);
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), body.toString('base64url')].join('.');
}

export function unseal(sealed: string): string {
  const [version, iv, tag, body] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || body === undefined) {
    throw new Error('Unknown sealed value.');
  }
  const decipher = createDecipheriv('aes-256-gcm', sealingKey(), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(body, 'base64url')), decipher.final()]).toString('utf8');
}

export const sha256 = (value: string) => createHash('sha256').update(value).digest('base64url');

/** An unguessable bearer value: 32 random bytes. */
export const newToken = () => randomBytes(32).toString('base64url');
