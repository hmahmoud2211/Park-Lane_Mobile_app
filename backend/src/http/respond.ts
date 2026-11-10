import type { ServerResponse } from 'node:http';

/** Response helpers shared by the API routes: JSON answers and redirects. */

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

/** A binary answer, e.g. synthesized speech. Never cached: it can carry medical content. */
export function sendBytes(res: ServerResponse, contentType: string, body: Buffer) {
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    // Files residents upload: never let a browser guess a different type than the one stored.
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

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
