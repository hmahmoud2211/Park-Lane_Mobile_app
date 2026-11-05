import { request } from 'node:http';

import { config } from '../config.ts';
import { ApiError } from '../errors.ts';
import { parseJsonOrText } from '../lib/json.ts';

/**
 * The Docker Engine API over its socket (DOCKER_SOCKET), which the provisioner uses to
 * create each unit's Home Assistant container. Whoever can reach the socket controls the
 * host: it is mounted into the backend's container only (backend/compose.yaml).
 */

interface DockerResponse {
  status: number;
  body: unknown;
}

export function docker(method: string, path: string, body?: unknown): Promise<DockerResponse> {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = request(
      {
        socketPath: config.ha.dockerSocket,
        path,
        method,
        headers: { Host: 'docker', ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}) },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          // Image pulls stream one JSON object per line, which stays text; callers only need the status.
          resolve({ status: res.statusCode ?? 0, body: parseJsonOrText(Buffer.concat(chunks).toString('utf8')) });
        });
      },
    );
    req.on('error', (error) => reject(new ApiError('not_configured', `Docker is not reachable at ${config.ha.dockerSocket}: ${error.message}`)));
    req.end(payload);
  });
}

export async function dockerOk(method: string, path: string, body?: unknown, allowed: readonly number[] = []): Promise<unknown> {
  const response = await docker(method, path, body);
  if (response.status >= 400 && !allowed.includes(response.status)) {
    const message = (response.body as { message?: string } | null)?.message ?? `HTTP ${response.status}`;
    throw new Error(`Docker ${method} ${path.split('?')[0]}: ${message}`);
  }
  return response.body;
}
