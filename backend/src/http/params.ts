import { ApiError } from '../errors.ts';

/** One URL path segment, decoded; a malformed escape is the caller's mistake (400), not the server's (500). */
export function decodeSegment(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new ApiError('bad_request', 'The address is malformed.');
  }
}
