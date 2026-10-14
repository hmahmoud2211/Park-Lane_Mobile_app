import {
  detailsTable,
  documentPage,
  escapeHtml,
  formatDocumentDate,
  section,
} from '../../services/documents/documentPage';
import type { PdfDocument } from '../../services/documents/pdf.types';
import { qrSvg } from '../../services/documents/qrSvg';
import { colors } from '../../theme';
import { resident, unit } from '../HomeScreen/HomeScreen.data';
import {
  guestsLabel,
  passPayload,
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
export function buildPassDocument(pass: VisitorPass): PdfDocument {
  const host = `${resident.firstName} ${resident.lastName}`;
  const details = [
    ['Visitor', pass.name],
    ['Mobile', pass.mobile],
    ['Visit Date', pass.date],
    ['Arrival Time', pass.time],
    ['Guests', guestsLabel(pass.guests)],
    ['Status', statusDisplay[pass.status].label],
    ...(pass.plate ? ([['Car Plate', pass.plate]] as const) : []),
  ] as const;

  const body = [
    `<div class="qr">${qrSvg(passPayload(pass), QR_SIZE, colors.deepNavy)}</div>`,
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
        `Hosted by ${host} · ${unit.title}`,
        `Issued ${formatDocumentDate(new Date())}`,
      ],
      body,
      note: 'Generated in the Park Lane app. Valid only for the visit above.',
    }),
  };
}
