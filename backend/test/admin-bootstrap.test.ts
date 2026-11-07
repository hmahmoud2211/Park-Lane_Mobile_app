import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

/**
 * The first admin account when no password is configured: one is generated, printed once, and must be changed.
 */

const ADMIN = 'admin-key-for-admin-tests';

Object.assign(process.env, {
  DATA_DIR: mkdtempSync(join(tmpdir(), 'ems-admin-boot-')),
  ADMIN_API_KEY: ADMIN,
  EMS_ADMIN_PASSWORD: '',
});

const { ensureAdminAccount, verifyCredentials } = await import('../src/ems/auth.ts');

test('without a configured password, the first admin gets a printed one-time password', async () => {
  const printed: string[] = [];
  const original = console.log;
  console.log = (...parts: unknown[]) => printed.push(parts.join(' '));
  try {
    await ensureAdminAccount();
    await ensureAdminAccount();
  } finally {
    console.log = original;
  }
  const output = printed.join('\n');
  assert.match(output, /Username: admin/);
  const password = /Temporary password: (\S+)/.exec(output)?.[1] ?? '';
  assert.equal(password.length, 14);
  assert.equal(printed.filter((line) => line.includes('Temporary password')).length, 1, 'printed once');
  const user = await verifyCredentials('admin', password);
  assert.equal(user.role, 'admin');
  assert.equal(user.mustChangePassword, true);
});
