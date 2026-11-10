import {
  detailsTable,
  documentPage,
  escapeHtml,
  formatDocumentDate,
  section,
} from '../../features/documents/services/documentPage';
import type { PdfDocument } from '../../features/documents/services/pdf.types';
import { qrSvg } from '../../features/documents/services/qrSvg';
import { colors } from '../../theme';
import { guestsLabel } from '../../utils/format';
import {
  statusDisplay,
  visitorAccessCopy as copy,
  type VisitorPass,
} from './VisitorAccessScreen.data';

/** Large enough to scan from a phone held at the gate. */
const QR_SIZE = 220;

/**
 * The pass the resident sends their visitor: a QR carrying the same payload as
 * the card's (so the gate reads either), at a sturdier error-correction level
 * for a code shown on another phone or printed, with the visit details under it.
 */
export function buildPassDocument(pass: VisitorPass, host: { name: string; unit: string }): PdfDocument {
  const details = [
    ['Visitor', pass.name],
    ...(pass.mobile ? ([['Mobile', pass.mobile]] as const) : []),
    ['Visit Date', pass.date],
    ['Arrival Time', pass.time],
    ['Guests', guestsLabel(pass.guests)],
    ['Status', statusDisplay[pass.status].label],
    ...(pass.plate ? ([['Car Plate', pass.plate]] as const) : []),
  ] as const;

  const body = [
    `<div class="qr">${qrSvg(pass.code, QR_SIZE, colors.deepNavy)}</div>`,
    `<p class="qr-caption">${escapeHtml(copy.passCaption)}</p>`,
    section('Visit', detailsTable(details)),
  ].join('');

  return {
    title: copy.passDocumentTitle,
    fileName: `Visitor-Pass-${pass.name.trim().replace(/[^A-Za-z0-9]+/g, '-')}`,
    html: documentPage({
      title: copy.passDocumentTitle,
      pageTitle: `${copy.passDocumentTitle} - ${pass.name}`,
      meta: [
        host.unit ? `Hosted by ${host.name} · ${host.unit}` : `Hosted by ${host.name}`,
        `Issued ${formatDocumentDate(new Date())}`,
      ],
      body,
      note: 'Issued by Park Lane. The gate checks this code; it works only for the visit above, and stops working if the resident cancels it.',
    }),
  };
}
