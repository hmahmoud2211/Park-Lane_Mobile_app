import type { IncomingMessage } from 'node:http';

import { ApiError } from '../errors.ts';

/** Request bodies: JSON objects of at most 16 KB, unless a route raises that. */

const MAX_BODY_BYTES = 16 * 1024;

/** The raw body, up to `maxBytes` (an audio recording, say). Larger bodies are refused as they arrive. */
export async function readBytes(req: IncomingMessage, maxBytes: number): Promise<Buffer> {
  // The 16 KB default has always answered 400; routes that raise the limit answer 413.
  const code = maxBytes === MAX_BODY_BYTES ? 'bad_request' : 'too_large';
  if (Number(req.headers['content-length'] ?? 0) > maxBytes) {
    throw new ApiError(code, 'Request body too large.');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > maxBytes) {
      throw new ApiError(code, 'Request body too large.');
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks);
}

/** `maxBytes` raises the 16 KB default for routes that take long text, such as consultation notes. */
export async function readJson(req: IncomingMessage, maxBytes = MAX_BODY_BYTES): Promise<Record<string, unknown>> {
  const text = (await readBytes(req, maxBytes)).toString('utf8');
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

