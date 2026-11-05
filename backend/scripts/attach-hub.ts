import { parseArgs } from 'node:util';

import { config } from '../src/config.ts';
import { AdminApiError, adminApi } from './lib/adminApi.ts';

/**
 * Attaches a Home Assistant you run yourself (on this PC, in WSL, or a box in
 * a unit) to a unit, and puts a resident in that unit, through the running
 * backend's admin API. For trying the app against a real hub without Docker.
 *
 *   npm run attach-hub -- --email you@example.com --url http://127.0.0.1:8123 --token <long-lived token>
 *
 * --unit names the unit (default "Test unit"); it is created when missing.
 * The resident signs up in the app (My Devices) first. The hub's address must
 * be inside HA_ALLOWED_NETWORKS, and the token is a long-lived access token
 * from the Home Assistant profile page (Security tab).
 */

const { values } = parseArgs({
  options: {
    email: { type: 'string' },
    url: { type: 'string' },
    token: { type: 'string' },
    unit: { type: 'string', default: 'Test unit' },
    backend: { type: 'string', default: `http://127.0.0.1:${config.port}` },
  },
});

if (!values.email || !values.url || !values.token) {
  console.error('Usage: npm run attach-hub -- --email <resident email> --url <Home Assistant URL> --token <long-lived token> [--unit "Unit name"]');
  process.exit(1);
}
if (!config.apiKey) {
  console.error('Set ADMIN_API_KEY in backend/.env (and restart the backend) first.');
  process.exit(1);
}

const call = adminApi(values.backend ?? '', config.apiKey);

async function admin<T>(method: string, path: string, body?: unknown): Promise<T> {
  try {
    return await call<T>(method, path, body);
  } catch (error) {
    if (error instanceof AdminApiError) {
      throw new Error(`${error.message} (${error.code})`);
    }
    throw new Error(`The backend is not running at ${values.backend}. Start it with "npm start" in backend/.`);
  }
}

try {
  const units = await admin<{ id: string; name: string }[]>('GET', '/api/admin/units');
  const unit = units.find((entry) => entry.name === values.unit) ?? (await admin<{ id: string; name: string }>('POST', '/api/admin/units', { name: values.unit, provision: false }));
  console.log(`Unit: ${unit.name}`);

  await admin('POST', `/api/admin/units/${unit.id}/members`, { email: values.email }).catch((error: Error) => {
    throw new Error(`${error.message}\nSign up in the app first (My Devices → Create account) with ${values.email}.`);
  });
  console.log(`Resident: ${values.email}`);

  const hub = await admin<{ status: string; haVersion: string | null }>('POST', '/api/admin/hubs', { unitId: unit.id, baseUrl: values.url, token: values.token });
  console.log(`Hub attached: ${values.url} (Home Assistant ${hub.haVersion ?? 'unknown version'}). Open My Devices in the app.`);
} catch (error) {
  console.error(`Failed: ${(error as Error).message}`);
  // Not process.exit(): on Windows, exiting while fetch's sockets close trips a libuv assertion.
  process.exitCode = 1;
}
