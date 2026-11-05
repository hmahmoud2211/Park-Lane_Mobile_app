import type { ServerResponse } from 'node:http';

import { config } from '../config.ts';

/** Sent on every answer, errors included; a browser's preflight (OPTIONS) gets them with a 204. */
export function applyCors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', config.corsOrigin);
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
}
