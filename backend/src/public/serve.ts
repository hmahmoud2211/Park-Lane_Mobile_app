import { readFileSync } from 'node:fs';
import type { ServerResponse } from 'node:http';

import { config } from '../config.ts';

/**
 * The public pages the store listings link to: the privacy policy (/privacy) and the page where an
 * account can be deleted without the app (/account/delete, which Google Play requires). Read once at
 * start; the operator's name and contact come from LEGAL_* settings (config.legal), never from code.
 * Until both are set, /privacy carries a visible draft notice.
 */

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string);

function fill(template: string): string {
  const { operatorName, contactEmail, policyDate } = config.legal;
  const operator = operatorName ? escapeHtml(operatorName) : 'the operator of the Park Lane resident service';
  const contact = contactEmail
    ? `<a href="mailto:${escapeHtml(contactEmail)}">${escapeHtml(contactEmail)}</a>`
    : 'the Park Lane building management office';
  const notice =
    operatorName && contactEmail
      ? ''
      : '<p class="notice" role="note">Draft: the operator\'s name and contact address are not set on this server yet (LEGAL_OPERATOR_NAME, LEGAL_CONTACT_EMAIL).</p>';
  return template
    .replaceAll('{{OPERATOR}}', operator)
    .replaceAll('{{CONTACT}}', contact)
    .replaceAll('{{UPDATED}}', escapeHtml(policyDate || 'not set'))
    .replaceAll('{{NOTICE}}', notice);
}

const read = (name: string) => readFileSync(new URL(`./${name}`, import.meta.url), 'utf8');

const FILES: Record<string, { type: string; body: Buffer }> = {
  '/privacy': { type: 'text/html; charset=utf-8', body: Buffer.from(fill(read('privacy.html'))) },
  '/account/delete': { type: 'text/html; charset=utf-8', body: Buffer.from(fill(read('delete.html'))) },
  '/public/delete.js': { type: 'text/javascript; charset=utf-8', body: Buffer.from(read('delete.js')) },
  '/public/page.css': { type: 'text/css; charset=utf-8', body: Buffer.from(read('page.css')) },
  '/public/pass.js': { type: 'text/javascript; charset=utf-8', body: Buffer.from(read('pass.js')) },
  '/public/pass.css': { type: 'text/css; charset=utf-8', body: Buffer.from(read('pass.css')) },
  '/public/join.js': { type: 'text/javascript; charset=utf-8', body: Buffer.from(read('join.js')) },
  '/public/join.css': { type: 'text/css; charset=utf-8', body: Buffer.from(read('join.css')) },
};

/** A visitor's parking pass: one page for every link; its script reads the token from the address. */
const PASS_PAGE = { type: 'text/html; charset=utf-8', body: Buffer.from(read('pass.html')) };
const PASS_PATH = /^\/parking\/pass\/inv_[A-Za-z0-9_-]{20,40}$/;

/**
 * A family invite's link (ems/membership.ts inviteLink, /join#<code>): one static page whose script reads the code
 * from the address and offers to open the app on it. The page looks nothing up, so it says nothing about the code.
 * /join/<code> is accepted as well, for codes typed into an address bar.
 */
const JOIN_PAGE = { type: 'text/html; charset=utf-8', body: Buffer.from(read('join.html')) };
const JOIN_PATH = /^\/join(\/[0-9A-Za-z]{4}-?[0-9A-Za-z]{4})?\/?$/;

const HEADERS = {
  'Cache-Control': 'no-cache',
  'Content-Security-Policy':
    "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'X-Frame-Options': 'DENY',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
};

/** Answers a request for one of the public pages; false for any other path. */
export function servePublic(path: string, method: string | undefined, res: ServerResponse): boolean {
  // Both pages' addresses carry a key (a pass token, an invite code): never cached or kept by a proxy.
  const passPage = PASS_PATH.test(path) || JOIN_PATH.test(path);
  const file = PASS_PATH.test(path) ? PASS_PAGE : JOIN_PATH.test(path) ? JOIN_PAGE : FILES[path.length > 1 ? path.replace(/\/+$/, '') : path];
  if (!file || (method !== 'GET' && method !== 'HEAD')) {
    return false;
  }
  res.writeHead(200, { ...HEADERS, ...(passPage ? { 'Cache-Control': 'no-store' } : {}), 'Content-Type': file.type, 'Content-Length': file.body.length });
  res.end(method === 'HEAD' ? undefined : file.body);
  return true;
}
