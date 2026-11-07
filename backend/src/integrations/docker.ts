import { request } from 'node:http';

import { config } from '../config.ts';
import { ApiError } from '../errors.ts';
import { parseJsonOrText } from '../lib/json.ts';

/**
 * The Docker Engine API over its socket (DOCKER_SOCKET), which the provisioners use to
 * create each unit's Home Assistant and CUBE gateway containers. Whoever can reach the socket controls the
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

/** Pulls `image` when Docker doesn't have it yet, or every time with `pull` (a newer build under the same tag). */
export async function ensureImage(image: string, { pull = false } = {}): Promise<void> {
  if (!pull && (await docker('GET', `/images/${encodeURIComponent(image)}/json`)).status !== 404) {
    return;
  }
  const colon = image.lastIndexOf(':');
  const [name, tag] = colon > image.lastIndexOf('/') ? [image.slice(0, colon), image.slice(colon + 1)] : [image, 'latest'];
  const progress = await dockerOk('POST', `/images/create?fromImage=${encodeURIComponent(name)}&tag=${encodeURIComponent(tag)}`);
  // A pull that fails part way (rate limit, registry down) still answers 200: the error is in the progress stream.
  const failed = /"error"\s*:\s*"([^"]*)"/.exec(typeof progress === 'string' ? progress : JSON.stringify(progress ?? {}));
  if (failed) {
    throw new Error(`Docker could not pull ${image}: ${failed[1]}`);
  }
}

/** Whether Docker has `image` already. */
export async function hasImage(image: string): Promise<boolean> {
  return (await docker('GET', `/images/${encodeURIComponent(image)}/json`)).status !== 404;
}
