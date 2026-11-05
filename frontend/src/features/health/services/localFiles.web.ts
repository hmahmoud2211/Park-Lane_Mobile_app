import { healthConfig } from '../../../config/health';
import { timedFetch } from '../../../lib/http/request';

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
  const file = await timedFetch(url, {
    init: { headers },
    timeoutMs: healthConfig.uploadTimeoutMs,
    noAnswer: () => new Error('No answer'),
    read: async (response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.blob();
    },
  });
  const objectUrl = URL.createObjectURL(file);
  window.open(objectUrl, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(objectUrl), REVOKE_AFTER_MS);
}
