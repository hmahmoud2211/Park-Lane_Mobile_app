import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';

import { PAGE_HEIGHT, PAGE_WIDTH, type PdfDocument } from './pdf.types';

/**
 * Opens the system's print preview, which shows the document page by page
 * (and on iOS offers sharing from there). Resolves once it is closed.
 */
export async function viewPdf(document: PdfDocument): Promise<void> {
  await Print.printAsync({ html: document.html, width: PAGE_WIDTH, height: PAGE_HEIGHT });
}

/**
 * Renders the PDF into the cache under a readable name, then opens the share
 * sheet so the resident can save it to Files or Drive, or send it on. Where
 * sharing is unavailable, falls back to the print preview, which can save a
 * PDF too.
 */
export async function downloadPdf(document: PdfDocument): Promise<void> {
  const { uri } = await Print.printToFileAsync({
    html: document.html,
    width: PAGE_WIDTH,
    height: PAGE_HEIGHT,
  });

  // expo-print names the file at random; the share sheet shows this name.
  const named = new File(Paths.cache, `${document.fileName}.pdf`);
  if (named.exists) {
    named.delete();
  }
  new File(uri).move(named);

  if (!(await Sharing.isAvailableAsync())) {
    await Print.printAsync({ uri: named.uri });
    return;
  }
  await Sharing.shareAsync(named.uri, {
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
    dialogTitle: document.title,
  });
}
