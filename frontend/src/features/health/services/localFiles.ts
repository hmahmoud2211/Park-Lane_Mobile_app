import { Directory, File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

/**
 * Originals opened from Health Passport are downloaded here only for the
 * system viewer to show, and the folder is emptied before each new one and
 * when the resident signs out. Nothing else of the feature touches disk.
 */
const ORIGINALS = new Directory(Paths.cache, 'health-originals');

export async function fileSize(uri: string): Promise<number> {
  try {
    return new File(uri).size;
  } catch {
    return 0;
  }
}

export function clearOriginals(): void {
  try {
    if (ORIGINALS.exists) ORIGINALS.delete();
  } catch {
    // Already gone, or still open in the viewer: cleared next time.
  }
}

/** Downloads an original (e.g. a PDF) with the session's headers and hands it to the system viewer. */
export async function openOriginal(url: string, headers: Record<string, string>, name: string): Promise<void> {
  let file: File;
  if (url.startsWith('file:')) {
    // Already on the phone, e.g. a document just picked for upload.
    file = new File(url);
  } else {
    clearOriginals();
    ORIGINALS.create({ idempotent: true, intermediates: true });
    file = await File.downloadFileAsync(url, new File(ORIGINALS, name), { headers, idempotent: true });
  }
  try {
    await File.preview(file);
  } catch {
    await Sharing.shareAsync(file.uri);
  }
}
