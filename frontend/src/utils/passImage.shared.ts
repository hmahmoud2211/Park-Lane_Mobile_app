import type { Lang } from '../services/parking/i18n';
import type { AppTheme } from '../types/theme.types';

/** A drawn QR code that can render itself to a PNG (react-native-svg's `toDataURL`). */
export interface QrImageSource {
  toDataURL: (callback: (base64: string) => void, options?: { width?: number; height?: number }) => void;
}

/** What goes on the saved pass image. */
export interface PassImageContent {
  qr: QrImageSource;
  /** Without an extension, e.g. "parking-pass-PL-7K2Q". */
  fileName: string;
  lang: Lang;
  /** e.g. "Guest parking pass". */
  title: string;
  compound: string;
  guest: string;
  /** The visit's date and times. */
  when: string;
  /** What to do with the code, e.g. "Show this code at the entrance gate." */
  caption: string;
  facts: readonly { label: string; value: string }[];
  footer: string;
  theme: AppTheme;
}

/**
 * What happened, as far as the app can tell. "shared" means the share sheet
 * opened with the image; whether the guest then saved it is not known.
 */
export type SavePassOutcome = 'downloaded' | 'shared' | 'dismissed' | 'failed';

/** The code as a base64 PNG, `px` square. */
export function qrPng(qr: QrImageSource, px: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The QR image took too long.')), 5000);
    try {
      qr.toDataURL(
        (base64) => {
          clearTimeout(timer);
          resolve(base64);
        },
        { width: px, height: px },
      );
    } catch (error) {
      clearTimeout(timer);
      reject(error);
    }
  });
}
