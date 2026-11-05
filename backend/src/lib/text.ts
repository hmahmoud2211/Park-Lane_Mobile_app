/** A name or label from a request body: trimmed and cut to `max` characters, or '' when it is not a string. */
export function trimmedText(input: unknown, max = 64): string {
  return typeof input === 'string' ? input.trim().slice(0, max) : '';
}
