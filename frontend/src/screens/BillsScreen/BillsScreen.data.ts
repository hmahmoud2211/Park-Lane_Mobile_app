import type { StatusTone } from '../../components/ui/StatusChip';
import type { ChargeStatus, PaymentMethod } from '../../../../shared/contracts/unitFinance';

/** Copy for Bills & Utilities (no Figma reference; set like the inner screens' panels). */
export const billsCopy = {
  title: 'Bills & Utilities',
  subtitle: 'Your apartment’s bills and what you paid.',
  billsHeading: 'Bills',
  paymentsHeading: 'Payments received',
  noBills: 'No bills yet. Building management adds them here.',
  noPayments: 'No payments recorded yet.',
  howToPay: 'Pay at the management office or by bank transfer; the payment then appears here with its receipt number.',
  memberTitle: 'Shown to the apartment’s owner',
  memberBody: 'Bills and payments are shown to the owner of the apartment.',
  noHomeTitle: 'Not linked to an apartment yet',
  noHomeBody: 'Ask building management to add your account to your apartment.',
  loadFailed: 'Couldn’t load your bills',
  retry: 'Try again',
  due: (date: string) => `Due ${date}`,
  left: (amount: string) => `${amount} left`,
} as const;

export const statusLook: Record<ChargeStatus, { label: string; tone: StatusTone }> = {
  paid: { label: 'Paid', tone: 'teal' },
  partial: { label: 'Partly paid', tone: 'amber' },
  due: { label: 'Due', tone: 'violet' },
  overdue: { label: 'Overdue', tone: 'red' },
  void: { label: 'Cancelled', tone: 'slate' },
};

export const methodLabel: Record<PaymentMethod, string> = {
  cash: 'Cash',
  bank_transfer: 'Bank transfer',
  cheque: 'Cheque',
  card_at_office: 'Card at the office',
};
