import type { IncomingMessage } from 'node:http';

import { config } from '../config.ts';
import { sign, signatureMatches } from '../ems/secrets.ts';
import { sealedFolder } from '../lib/sealedFiles.ts';
import { listDocumentPages } from '../repositories/healthDocuments.ts';
import { listSummaryAudioFiles } from '../repositories/healthSummaries.ts';

/**
 * Health Passport's files: the pages of uploaded documents and recorded
 * summaries, sealed (AES-256-GCM) in DATA_DIR/health/files, owner-only.
 *
 * The app plays and shows them by URL. A phone sends its session with the
 * request, but a browser's <audio> and <img> cannot, so each URL handed out
 * also carries a signature that opens that one file for LINK_TTL_MS.
 */

const LINK_TTL_MS = 2 * 3600_000;

/** DATA_DIR/health/files, as before the folder logic moved to lib/sealedFiles.ts. */
const folder = sealedFolder('health', 'files');

export const storeFile = (bytes: Buffer): string => folder.store(bytes);

export const readStoredFile = (name: string): Buffer | null => folder.read(name);

export const removeFiles = (names: readonly string[]): void => folder.remove(names);

/** Files no document or summary refers to any more, e.g. after a profile or consent was removed. Deleted at once. */
export function sweepOrphanFiles(): number {
  const used = new Set<string>();
  for (const pages of listDocumentPages()) {
    for (const page of JSON.parse(pages) as { file: string }[]) used.add(page.file);
  }
  for (const file of listSummaryAudioFiles()) {
    used.add(file);
  }
  const orphans = folder.list().filter((name) => !used.has(name));
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
