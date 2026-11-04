import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * DEVELOPMENT ONLY: the backend on :8787 against the test suite's stand-in
 * Home Assistant, so the app's smart-home screens can be tried without Docker
 * or real brand accounts.
 *
 *   npm run fake-hub
 *   (app) EXPO_PUBLIC_DEVICE_BACKEND_URL=http://<this machine>:8787 npx expo start
 *
 * Sign in to the EMS account in the app (My Devices) as
 * demo@parklane.test / correct horse battery. The unit starts with a few
 * devices; "Connect devices" links the scripted brands:
 *  - SwitchBot: any token and secret ("bad" as the token shows the brand's error)
 *  - Tuya / Smart Life: any user code, then the QR step (tap Continue)
 * Everything lives in a temporary folder and is gone when the process stops.
 */

const PORT = Number(process.env.PORT || 8787);

Object.assign(process.env, {
  DATA_DIR: mkdtempSync(join(tmpdir(), 'parklane-fake-hub-')),
  ADMIN_API_KEY: 'fake-hub-admin',
  HA_ALLOWED_NETWORKS: '127.0.0.0/8',
  HA_COMMAND_TIMEOUT_MS: '1500',
});

const { FakeHa, demoHome } = await import('../test/fakeHa.ts');
const { createApp } = await import('../src/app.ts');

const HUB_TOKEN = 'fake-hub-token-000000000000';
const ha = new FakeHa(demoHome(), HUB_TOKEN);
await ha.listen();
const app = createApp();
await new Promise<void>((resolve) => app.listen(PORT, '0.0.0.0', resolve));

async function api(method: string, path: string, body?: unknown) {
  const response = await fetch(`http://127.0.0.1:${PORT}${path}`, {
    method,
    headers: { Authorization: 'Bearer fake-hub-admin', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const parsed = (await response.json()) as { ok: boolean; data: Record<string, string>; error?: { message: string } };
  if (!parsed.ok) {
    throw new Error(`${method} ${path}: ${parsed.error?.message}`);
  }
  return parsed.data;
}

await api('POST', '/api/auth/register', { email: 'demo@parklane.test', password: 'correct horse battery', name: 'Demo resident' });
const unit = await api('POST', '/api/admin/units', { name: 'Unit A-302', building: 'Tower A', provision: false });
await api('POST', `/api/admin/units/${unit.id}/members`, { email: 'demo@parklane.test' });
await api('POST', '/api/admin/hubs', { unitId: unit.id, baseUrl: `http://127.0.0.1:${ha.port}`, token: HUB_TOKEN });

console.log(`Fake hub ready: backend on http://0.0.0.0:${PORT}, sign in as demo@parklane.test / correct horse battery`);
