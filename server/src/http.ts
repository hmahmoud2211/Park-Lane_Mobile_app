import type { IncomingMessage, ServerResponse } from 'node:http';

import { ApiError } from './errors.ts';

/** Small response and body helpers shared by the API, OAuth and linking routes. */

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
  // The pages carry no scripts and load nothing from elsewhere. form-action
  // also governs the redirect after a submit, which goes back to Amazon.
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https:; frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
};

export function html(res: ServerResponse, status: number, page: string) {
  res.writeHead(status, { ...PAGE_HEADERS, 'Content-Length': Buffer.byteLength(page) });
  res.end(page);
}

/** A redirect with a short page for browsers that do not follow it (e.g. to an app scheme). */
export function redirect(res: ServerResponse, location: string) {
  const page = `<!doctype html><meta charset="utf-8"><title>Redirecting</title><p><a href="${escapeHtml(location)}">Continue</a></p>`;
  res.writeHead(302, { ...PAGE_HEADERS, Location: location, 'Content-Length': Buffer.byteLength(page) });
  res.end(page);
}

export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

/** A binary answer, e.g. synthesized speech. Never cached: it can carry medical content. */
export function sendBytes(res: ServerResponse, contentType: string, body: Buffer) {
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

/** The raw body, up to `maxBytes` (an audio recording, say). Larger bodies are refused as they arrive. */
export async function readBytes(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  // The 16 KB default has always answered 400; routes that raise the limit answer 413.
  const code = maxBytes === MAX_BODY_BYTES ? 'bad_request' : 'too_large';
  if (Number(req.headers['content-length'] ?? 0) > maxBytes) {
    throw new ApiError(code, 'Request body too large.');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) {
      throw new ApiError(code, 'Request body too large.');
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

async function readText(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<string> {
  return (await readBytes(req, maxBytes)).toString('utf8');
}

/** `maxBytes` raises the 16 KB default for routes that take long text, such as consultation notes. */
export async function readJson(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<Record<string, unknown>> {
  const text = await readText(req, maxBytes);
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

/** application/x-www-form-urlencoded, as OAuth clients and HTML forms send. */
export async function readForm(req: IncomingMessage): Promise<Record<string, string>> {
  return Object.fromEntries(new URLSearchParams(await readText(req)));
}
