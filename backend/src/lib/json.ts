/** A body as JSON when it is JSON, else as the text itself (some errors are plain text); null when empty. */
export function parseJsonOrText(text: string): unknown {
  if (!text) {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}
