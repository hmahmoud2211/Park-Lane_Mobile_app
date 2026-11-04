/**
 * A document rendered from HTML into a PDF on the device, implemented per
 * platform: `exportPdf.ts` on expo-print and expo-sharing for iOS and
 * Android, `exportPdf.web.ts` on the browser's own window and print dialog.
 */
export interface PdfDocument {
  /** Shown on the share sheet and as the page title. */
  title: string;
  /** Without the extension, e.g. "Contract-Summary-A-302". */
  fileName: string;
  /** A complete HTML page, styles inline: it is rendered without the app. */
  html: string;
}

/** A4 at 72 points per inch, the paper size used in Egypt. */
export const PAGE_WIDTH = 595;
export const PAGE_HEIGHT = 842;
