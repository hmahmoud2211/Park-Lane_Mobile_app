import type { Payment, UnitOverview } from '../../../../shared/contracts/unitFinance';
import {
  detailsTable,
  documentPage,
  escapeHtml,
  formatDocumentDate,
  section,
} from '../../features/documents/services/documentPage';
import type { PdfDocument } from '../../features/documents/services/pdf.types';
import { day, egp } from '../../features/unitFinance/format';
import { financialFrom, heroFrom, maintenanceFeesFrom, overviewColumnsFrom } from './MyUnitScreen.data';

/*
 * The documents the app makes for a unit's owner: a contract summary and the receipts, from building management's
 * records (GET /api/unit/overview, /api/unit/payments), so a PDF never disagrees with the card it came from and
 * never shows a number nobody recorded. The page is the shared one in services/documents/documentPage.ts.
 */

function page(overview: UnitOverview, holder: string, title: string, body: string, note: string): string {
  const hero = heroFrom(overview.details);
  return documentPage({
    title,
    pageTitle: `${title} - ${hero.title}`,
    meta: [`${hero.title} · ${hero.meta}`, `Prepared for ${holder} · Generated ${formatDocumentDate(new Date())}`],
    body,
    note,
  });
}

function unitDetails(overview: UnitOverview): string {
  const values = Object.fromEntries(overviewColumnsFrom(overview.details).flat().map((item) => [item.id, item.value]));
  const hero = Object.fromEntries(heroFrom(overview.details).stats.map((item) => [item.id, item.value]));
  return section(
    'Unit',
    detailsTable([
      ['Building', values.building],
      ['Floor', values.floor],
      ['Unit Type', values['unit-type']],
      ['Area', hero.area],
      ['Bedrooms', values.bedrooms],
      ['Bathrooms', values.bathrooms],
      ['Parking', values.parking],
    ]),
  );
}

const fileCode = (overview: UnitOverview) => overview.details.name.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-|-$/g, '');

export function contractSummary(overview: UnitOverview, holder: string): PdfDocument {
  if (!overview.finance) throw new Error('Only owners have a contract summary.');
  const figures = financialFrom(overview.finance);
  const summary = Object.fromEntries(figures.summary.map((item) => [item.id, item.value]));
  const schedule = Object.fromEntries(figures.schedule.map((item) => [item.id, item.value]));
  const contract = overview.finance.contract;
  const body = [
    section(
      'Parties',
      detailsTable([
        ['Owner', holder],
        ['Unit', overview.details.name],
        ['Signed', contract?.signedOn ? day(contract.signedOn) : '—'],
        ['Handover Status', overview.details.handoverStatus ?? '—'],
      ]),
    ),
    unitDetails(overview),
    section(
      'Payment Terms',
      detailsTable([
        ['Unit Price', summary.price],
        ['Amount Paid', `${summary.paid} (${figures.paidLabel})`],
        ['Remaining Balance', summary.remaining],
        ['Next Installment', schedule['next-installment']],
        ['Due Date', schedule['due-date']],
        ['Remaining Installments', schedule['remaining-installments']],
      ]),
    ),
    section('Maintenance Fees', detailsTable(maintenanceFeesFrom(overview.finance).map((item) => [item.label, item.value] as const))),
  ].join('');
  return {
    title: 'Contract Summary',
    fileName: `Contract-Summary-${fileCode(overview)}`,
    html: page(overview, holder, 'Contract Summary', body, 'Made in the Park Lane app from building management’s records. It summarises your contract and does not replace the signed contract.'),
  };
}

export function paymentReceipts(overview: UnitOverview, payments: readonly Payment[], holder: string): PdfDocument {
  const total = payments.reduce((sum, payment) => sum + payment.amount, 0);
  const rows = payments
    .map(
      (payment) =>
        `<tr><td>${escapeHtml(day(payment.paidOn))}</td><td>${escapeHtml(payment.chargeTitle ?? 'Payment')}</td>` +
        `<td>${escapeHtml(payment.receiptNo)}</td><td class="amount">${escapeHtml(egp(payment.amount))}</td></tr>`,
    )
    .join('');
  const ledger =
    '<table class="ledger"><thead><tr><th>Date</th><th>Description</th><th>Receipt No.</th><th class="amount">Amount</th></tr></thead>' +
    `<tbody>${rows}<tr class="total"><td colspan="3">Total paid (${payments.length} payments)</td><td class="amount">${escapeHtml(egp(total))}</td></tr></tbody></table>`;
  const contract = overview.finance?.contract;
  const body = [
    contract
      ? section('Summary', detailsTable([['Unit Price', egp(contract.price)], ['Amount Paid', egp(contract.paid)], ['Remaining Balance', egp(contract.remaining)]]))
      : '',
    section('Payments Received', payments.length ? ledger : '<div class="placeholder">No payments have been recorded yet.</div>'),
  ].join('');
  return {
    title: 'Payment Receipts',
    fileName: `Payment-Receipts-${fileCode(overview)}`,
    html: page(overview, holder, 'Payment Receipts', body, 'Made in the Park Lane app from building management’s records. Each line is a payment they recorded, with its receipt number.'),
  };
}
