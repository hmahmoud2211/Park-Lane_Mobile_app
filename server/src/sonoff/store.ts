import { randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { config } from '../config.ts';

/**
 * Registered plugs, and the secret in the hub's command URL, kept in
 * DATA_DIR/sonoff.json with owner-only permissions. Plug keys are stored
 * because the bridge needs them for every command; they never leave this
 * file except inside encrypted LAN commands.
 */

export interface StoredPlug {
  deviceId: string;
  deviceKey: string;
  name: string;
  cubeSerial: string;
  thirdSerial: string;
  host: string;
  port: number;
  encrypted: boolean;
  power: 'on' | 'off' | null;
  online: boolean;
  missedRounds: number;
  registeredAt: string;
}

interface StoreFile {
  /** Part of the service address the hub posts commands to, so only the hub can. */
  directiveSecret: string;
  plugs: StoredPlug[];
}

const FILE = join(config.dataDir, 'sonoff.json');

let cache: StoreFile | null = null;
let writing: Promise<void> = Promise.resolve();

async function load(): Promise<StoreFile> {
  if (cache) {
    return cache;
  }
  try {
    cache = JSON.parse(await readFile(FILE, 'utf8')) as StoreFile;
  } catch {
    cache = { directiveSecret: randomBytes(18).toString('base64url'), plugs: [] };
    await save();
  }
  return cache;
}

/** Writes are queued and atomic (temp file, then rename). */
function save(): Promise<void> {
  const snapshot = JSON.stringify(cache, null, 2);
  writing = writing.then(async () => {
    await mkdir(config.dataDir, { recursive: true, mode: 0o700 });
    const temp = `${FILE}.tmp`;
    await writeFile(temp, snapshot, { mode: 0o600 });
    await rename(temp, FILE);
    await chmod(FILE, 0o600);
  });
  return writing;
}

export async function directiveSecret(): Promise<string> {
  return (await load()).directiveSecret;
}

export async function listPlugs(): Promise<StoredPlug[]> {
  return (await load()).plugs;
}

export async function findPlug(match: { deviceId?: string; cubeSerial?: string; thirdSerial?: string }) {
  return (await load()).plugs.find(
    (plug) =>
      (match.deviceId !== undefined && plug.deviceId === match.deviceId) ||
      (match.cubeSerial !== undefined && plug.cubeSerial === match.cubeSerial) ||
      (match.thirdSerial !== undefined && plug.thirdSerial === match.thirdSerial),
  );
}

export async function upsertPlug(plug: StoredPlug): Promise<void> {
  const store = await load();
  store.plugs = [...store.plugs.filter((entry) => entry.deviceId !== plug.deviceId), plug];
  await save();
}

export async function updatePlug(deviceId: string, changes: Partial<StoredPlug>): Promise<void> {
  const store = await load();
  const plug = store.plugs.find((entry) => entry.deviceId === deviceId);
  if (plug) {
    Object.assign(plug, changes);
    await save();
  }
}
