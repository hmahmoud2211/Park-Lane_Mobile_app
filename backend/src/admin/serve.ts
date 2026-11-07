import { readFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';

/**
 * The admin dashboard's three files, served at /admin. They are read once at start. The page signs in with an EMS
 * admin account and talks only to /api/* on this same backend; the headers keep it from being framed, cached or
 * made to load anything from elsewhere.
 */

const FILES: Record<string, { type: string; body: Buffer }> = {
  '/admin': { type: 'text/html; charset=utf-8', body: readFileSync(new URL('./index.html', import.meta.url)) },
  '/admin/app.js': { type: 'text/javascript; charset=utf-8', body: readFileSync(new URL('./app.js', import.meta.url)) },
  '/admin/app.css': { type: 'text/css; charset=utf-8', body: readFileSync(new URL('./app.css', import.meta.url)) },
};

const HEADERS = {
  'Cache-Control': 'no-store',
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

/** Answers a request for the dashboard; false for any other path. */
export function serveAdmin(path: string, method: string | undefined, res: ServerResponse): boolean {
  const file = FILES[path === '/admin/' || path === '/admin/index.html' ? '/admin' : path];
  if (!file || (method !== 'GET' && method !== 'HEAD')) {
    return false;
  }
  res.writeHead(200, { ...HEADERS, 'Content-Type': file.type, 'Content-Length': file.body.length });
  res.end(method === 'HEAD' ? undefined : file.body);
  return true;
}
