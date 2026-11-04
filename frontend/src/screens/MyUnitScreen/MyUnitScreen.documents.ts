import {
  detailsTable,
  documentPage,
  escapeHtml,
  formatDocumentDate,
  section,
} from '../../services/documents/documentPage';
import type { PdfDocument } from '../../services/documents/pdf.types';
import { resident } from '../HomeScreen/HomeScreen.data';
import {
  financial,
  maintenanceFees,
  overviewColumns,
  paymentHistory,
  unitHero,
  type DocumentId,
} from './MyUnitScreen.data';

/*
 * The three unit documents, rendered from the same data the screen shows, so
 * a PDF never disagrees with the card it came from. The page itself is the
 * shared one in services/documents/documentPage.ts.
 */

/** "EGP 5,525,000". */
function egp(amount: number): string {
  return `EGP ${String(amount).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
}

const overview = Object.fromEntries(overviewColumns.flat().map((item) => [item.id, item.value]));
const heroStat = Object.fromEntries(unitHero.stats.map((item) => [item.id, item.value]));
const summary = Object.fromEntries(financial.summary.map((item) => [item.id, item.value]));
const schedule = Object.fromEntries(financial.schedule.map((item) => [item.id, item.value]));

const unitCode = unitHero.title.replace(/^Unit\s+/, '');
const residentName = `${resident.firstName} ${resident.lastName}`;

/** A unit document's page: titled, and dated for the resident. */
function page(title: string, body: string, note: string): string {
  return documentPage({
    title,
    pageTitle: `${title} - ${unitHero.title}`,
    meta: [
      `${unitHero.title} · ${unitHero.meta}`,
      `Prepared for ${residentName} · Generated ${formatDocumentDate(new Date())}`,
    ],
    body,
    note,
  });
}

const unitDetails = section(
  'Unit',
  detailsTable([
    ['Building', overview.building],
    ['Floor', overview.floor],
    ['Unit Type', overview['unit-type']],
    ['Area', heroStat.area],
    ['Bedrooms', overview.bedrooms],
    ['Bathrooms', overview.bathrooms],
    ['Parking', overview.parking],
    ['Ownership', heroStat.ownership],
  ]),
);

function contractSummary(): PdfDocument {
  const body = [
    section(
      'Parties',
      detailsTable([
        ['Resident', residentName],
        ['Unit', unitHero.title],
        ['Handover Status', overview.handover],
      ]),
    ),
    unitDetails,
    section(
      'Payment Terms',
      detailsTable([
        ['Unit Price', summary.price],
        ['Amount Paid', `${summary.paid} (${financial.paidLabel})`],
        ['Remaining Balance', summary.remaining],
        ['Next Installment', schedule['next-installment']],
        ['Due Date', schedule['due-date']],
        ['Remaining Installments', schedule['remaining-installments']],
      ]),
    ),
    section(
      'Maintenance Fees',
      detailsTable(maintenanceFees.map((item) => [item.label, item.value] as const)),
    ),
  ].join('');

  return {
    title: 'Contract Summary',
    fileName: `Contract-Summary-${unitCode}`,
    html: page(
      'Contract Summary',
      body,
      'Generated in the Park Lane app from your account details. It summarises your contract and does not replace the signed contract.',
    ),
  };
}

function paymentReceipts(): PdfDocument {
  const total = paymentHistory.reduce((sum, payment) => sum + payment.amount, 0);
  const rows = paymentHistory
    .map(
      (payment) =>
        `<tr><td>${escapeHtml(payment.date)}</td><td>${escapeHtml(payment.description)}</td>` +
        `<td>${escapeHtml(payment.id)}</td><td class="amount">${egp(payment.amount)}</td></tr>`,
    )
    .join('');
  const ledger =
    '<table class="ledger"><thead><tr><th>Date</th><th>Description</th><th>Receipt No.</th>' +
    '<th class="amount">Amount</th></tr></thead>' +
    `<tbody>${rows}<tr class="total"><td colspan="3">Total paid (${paymentHistory.length} payments)</td>` +
    `<td class="amount">${egp(total)}</td></tr></tbody></table>`;

  const body = [
    section(
      'Summary',
      detailsTable([
        ['Unit Price', summary.price],
        ['Amount Paid', summary.paid],
        ['Remaining Balance', summary.remaining],
        ['Next Installment', `${schedule['next-installment']} on ${schedule['due-date']}`],
      ]),
    ),
    section('Payments Received', ledger),
  ].join('');

  return {
    title: 'Payment Receipts',
    fileName: `Payment-Receipts-${unitCode}`,
    html: page(
      'Payment Receipts',
      body,
      'Generated in the Park Lane app from your payment history. Each line stands for the receipt issued with that payment.',
    ),
  };
}

function floorPlan(): PdfDocument {
  const body = [
    unitDetails,
    section(
      'Plan',
      `<div class="placeholder">The architectural floor plan for ${escapeHtml(unitHero.title)} ` +
        'has not been added to the app yet.</div>',
    ),
  ].join('');

  return {
    title: 'Floor Plan',
    fileName: `Floor-Plan-${unitCode}`,
    html: page('Floor Plan', body, 'Generated in the Park Lane app from your unit details.'),
  };
}

const builders: Record<DocumentId, () => PdfDocument> = {
  contract: contractSummary,
  receipts: paymentReceipts,
  'floor-plan': floorPlan,
};

/** Renders the document behind a My Unit tile, dated today. */
export function buildUnitDocument(id: DocumentId): PdfDocument {
  return builders[id]();
}
