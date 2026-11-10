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
};

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
  const file = FILES[path.length > 1 ? path.replace(/\/+$/, '') : path];
  if (!file || (method !== 'GET' && method !== 'HEAD')) {
    return false;
  }
  res.writeHead(200, { ...HEADERS, 'Content-Type': file.type, 'Content-Length': file.body.length });
  res.end(method === 'HEAD' ? undefined : file.body);
  return true;
}
