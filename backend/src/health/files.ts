import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { IncomingMessage } from 'node:http';
import { join } from 'node:path';

import { config } from '../config.ts';
import { db } from '../ems/db.ts';
import { sealBytes, sign, signatureMatches, unsealBytes } from '../ems/secrets.ts';

/**
 * Health Passport's files: the pages of uploaded documents and recorded
 * summaries, sealed (AES-256-GCM) in DATA_DIR/health/files, owner-only.
 *
 * The app plays and shows them by URL. A phone sends its session with the
 * request, but a browser's <audio> and <img> cannot, so each URL handed out
 * also carries a signature that opens that one file for LINK_TTL_MS.
 */

const LINK_TTL_MS = 2 * 3600_000;

const directory = () => join(config.dataDir, 'health', 'files');

export function storeFile(bytes: Buffer): string {
  mkdirSync(directory(), { recursive: true, mode: 0o700 });
  const name = randomUUID();
  writeFileSync(join(directory(), name), sealBytes(bytes), { mode: 0o600 });
  return name;
}

export function readStoredFile(name: string): Buffer | null {
  const file = join(directory(), name);
  if (!/^[0-9a-f-]{36}$/.test(name) || !existsSync(file)) return null;
  return unsealBytes(readFileSync(file));
}

export function removeFiles(names: readonly string[]): void {
  for (const name of names) {
    if (/^[0-9a-f-]{36}$/.test(name)) rmSync(join(directory(), name), { force: true });
  }
}

/** Files no document or summary refers to any more, e.g. after a profile or consent was removed. Deleted at once. */
export function sweepOrphanFiles(): number {
  if (!existsSync(directory())) return 0;
  const used = new Set<string>();
  for (const row of db().prepare('SELECT pages FROM health_documents').all() as { pages: string }[]) {
    for (const page of JSON.parse(row.pages) as { file: string }[]) used.add(page.file);
  }
  for (const row of db().prepare('SELECT audio_file FROM health_summaries WHERE audio_file IS NOT NULL').all() as { audio_file: string }[]) {
    used.add(row.audio_file);
  }
  const orphans = readdirSync(directory()).filter((name) => !used.has(name));
  removeFiles(orphans);
  return orphans.length;
}

/** Where the app reaches this backend: PUBLIC_URL, else the address the request came to. */
export function publicBase(req: IncomingMessage): string {
  if (config.publicUrl) return config.publicUrl;
  const proto = config.ems.trustProxy ? String(req.headers['x-forwarded-proto'] ?? 'http').split(',')[0] : 'http';
  return `${proto}://${req.headers.host ?? 'localhost'}`;
}

/** An absolute URL for `path` that works for LINK_TTL_MS without a session. */
export function signedUrl(base: string, path: string): string {
  const expires = Math.floor((Date.now() + LINK_TTL_MS) / 1000);
  return `${base}${path}?exp=${expires}&sig=${sign(`${path}|${expires}`)}`;
}

export function linkValid(path: string, url: URL): boolean {
  const expires = Number(url.searchParams.get('exp'));
  const signature = url.searchParams.get('sig') ?? '';
  return Number.isFinite(expires) && expires * 1000 > Date.now() && signatureMatches(`${path}|${expires}`, signature);
}
