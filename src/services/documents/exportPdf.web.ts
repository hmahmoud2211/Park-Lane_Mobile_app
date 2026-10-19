import type { PdfDocument } from './pdf.types';

/*
 * On the web, expo-print can only print the current page and expo-sharing
 * cannot share a local file, so the browser does the work itself: the
 * document opens as its own page, and "Download" goes through the print
 * dialog, whose "Save as PDF" destination names the file after the page
 * title.
 */

/** How long to keep the print frame after the dialog, for browsers without `afterprint`. */
const FRAME_CLEANUP_MS = 60_000;

/**
 * Opens the document in a new tab. Must run inside the tap that asked for it,
 * before any `await`, or the browser blocks the new window.
 */
export async function viewPdf(document: PdfDocument): Promise<void> {
  const tab = window.open('', '_blank');
  if (!tab) {
    throw new Error('The browser blocked the new tab.');
  }
  tab.document.open();
  tab.document.write(document.html);
  tab.document.close();
}

/** Opens the print dialog for the document, from a hidden frame. */
export async function downloadPdf(document: PdfDocument): Promise<void> {
  const frame = window.document.createElement('iframe');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.position = 'fixed';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  frame.srcdoc = document.html;

  await new Promise<void>((resolve, reject) => {
    frame.onload = () => {
      const view = frame.contentWindow;
      if (!view) {
        reject(new Error('The print frame did not load.'));
        return;
      }
      const remove = () => frame.remove();
      view.addEventListener('afterprint', remove, { once: true });
      setTimeout(remove, FRAME_CLEANUP_MS);
      view.focus();
      view.print();
      resolve();
    };
    window.document.body.appendChild(frame);
  });
}
