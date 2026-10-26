import type { IncomingMessage, ServerResponse } from 'node:http';

import { ApiError } from './errors.ts';

/** Small response and body helpers shared by the API routes. */

const MAX_BODY_BYTES = 16 * 1024;

export function send(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
    ...headers,
  });
  res.end(text);
}

export const ok = (res: ServerResponse, data: unknown) => send(res, 200, { ok: true, data });

const PAGE_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  // The pages carry no scripts and load nothing from elsewhere.
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https:; frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};

/** A redirect with a short page for browsers that do not follow it (e.g. to an app scheme). */
export function redirect(res: ServerResponse, location: string) {
  const page = `<!doctype html><meta charset="utf-8"><title>Redirecting</title><p><a href="${escapeHtml(location)}">Continue</a></p>`;
  res.writeHead(302, { ...PAGE_HEADERS, Location: location, 'Content-Length': Buffer.byteLength(page) });
  res.end(page);
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

async function readText(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) {
      throw new ApiError('bad_request', 'Request body too large.');
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const text = await readText(req);
  if (!text) {
    return {};
  }
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('not an object');
    }
    return value as Record<string, unknown>;
  } catch {
    throw new ApiError('bad_request', 'The body must be a JSON object.');
  }
}

