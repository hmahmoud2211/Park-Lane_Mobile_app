/**
 * The one part of `qrcode` the app calls directly (see
 * services/documents/qrSvg.ts); the package ships no types of its own.
 */
declare module 'qrcode' {
  export interface QRCodeData {
    modules: {
      /** Modules per side. */
      size: number;
      /** Row-major, truthy where the module is dark. */
      data: ArrayLike<number | boolean>;
    };
  }

  export function create(
    text: string,
    options?: { errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' },
  ): QRCodeData;
}
