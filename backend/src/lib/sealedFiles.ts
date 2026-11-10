import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { config } from '../config.ts';
import { sealBytes, unsealBytes } from '../ems/secrets.ts';

/**
 * Files people upload (Health Passport pages, maintenance photos, unit documents…), sealed with AES-256-GCM in a
 * folder under DATA_DIR that only this process can read. Each file is a random UUID name; anything else is never
 * read or removed, so a name from a request can't reach outside the folder.
 */

const NAME = /^[0-9a-f-]{36}$/;

export interface SealedFolder {
  store(bytes: Buffer): string;
  read(name: string): Buffer | null;
  remove(names: readonly string[]): void;
  /** Every stored name, for sweeping files nothing refers to any more. */
  list(): string[];
}

export function sealedFolder(...segments: string[]): SealedFolder {
  const directory = () => join(config.dataDir, ...segments);
  return {
    store(bytes) {
      mkdirSync(directory(), { recursive: true, mode: 0o700 });
      const name = randomUUID();
      writeFileSync(join(directory(), name), sealBytes(bytes), { mode: 0o600 });
      return name;
    },
    read(name) {
      const file = join(directory(), name);
      if (!NAME.test(name) || !existsSync(file)) return null;
      return unsealBytes(readFileSync(file));
    },
    remove(names) {
      for (const name of names) {
        if (NAME.test(name)) rmSync(join(directory(), name), { force: true });
      }
    },
    list() {
      return existsSync(directory()) ? readdirSync(directory()).filter((name) => NAME.test(name)) : [];
    },
  };
}
