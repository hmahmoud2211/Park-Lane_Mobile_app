import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';

import { qrPng, type PassImageContent, type SavePassOutcome } from './passImage.shared';

export type { PassImageContent, QrImageSource, SavePassOutcome } from './passImage.shared';

/**
 * iOS and Android: saves the code itself as a PNG, quiet zone included, and
 * opens the share sheet, where "Save Image" puts it in the guest's photos.
 * The full pass card is drawn on web only (see passImage.web.ts).
 */
export async function savePassImage({ qr, fileName, title }: PassImageContent): Promise<SavePassOutcome> {
  try {
    if (!(await Sharing.isAvailableAsync())) {
      return 'failed';
    }
    const base64 = await qrPng(qr, 1024);
    const file = new File(Paths.cache, `${fileName}.png`);
    if (file.exists) {
      file.delete();
    }
    file.create();
    file.write(base64, { encoding: 'base64' });
    await Sharing.shareAsync(file.uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: title });
    return 'shared';
  } catch {
    return 'failed';
  }
}
