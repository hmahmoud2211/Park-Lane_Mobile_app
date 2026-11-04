import type { IncomingMessage } from 'node:http';

import { ApiError } from '../errors.ts';

/** Request bodies: JSON objects of at most 16 KB. */

const MAX_BODY_BYTES = 16 * 1024;

async function readText(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) {
      throw new ApiError('bad_request', 'Request body too large.');
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const text = await readText(req);
  if (!text) {
    return {};
  }
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('not an object');
    }
    return value as Record<string, unknown>;
  } catch {
    throw new ApiError('bad_request', 'The body must be a JSON object.');
  }
}

