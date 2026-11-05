/**
 * Web: files stay in the browser's memory. An opened original is a blob URL
 * that is revoked shortly after the new tab has loaded it.
 */
const REVOKE_AFTER_MS = 60_000;

export async function fileSize(uri: string): Promise<number> {
  try {
    return (await (await fetch(uri)).blob()).size;
  } catch {
    return 0;
  }
}

export function clearOriginals(): void {
  // Nothing is written to disk on web.
}

export async function openOriginal(url: string, headers: Record<string, string>, _name: string): Promise<void> {
  const response = await fetch(url, { headers });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const objectUrl = URL.createObjectURL(await response.blob());
  window.open(objectUrl, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(objectUrl), REVOKE_AFTER_MS);
}
