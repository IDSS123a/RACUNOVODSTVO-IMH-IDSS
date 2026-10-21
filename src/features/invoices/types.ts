import type { Fenings } from '@/features/billing/money';
import type { LegalEntityCode, PriceItemCode, ProgramCode } from '@/features/price-lists/types';

/** Invoice domain types (Sprint 03). The invoice number is assigned by the backend (BR-23). */

/** "YYYY-MM" — the month an invoice covers. */
export type BillingMonth = `${number}-${number}`;

export interface InvoiceLine {
  readonly itemCode: PriceItemCode;
  readonly description: string;
  readonly childId: string;
  readonly enrolmentId: string;
  readonly program: ProgramCode;
  /** Price-list amount before any board decision. */
  readonly listAmount: Fenings;
  /** Board decision applied to this line, if any (BR-7). */
  readonly boardDecisionId: string | null;
  /** Final line amount — rounded once (DL-P003). */
  readonly amount: Fenings;
}

/** An invoice before it gets a number — one per child, entity and month (BR-27). */
export interface InvoiceDraft {
  readonly entity: LegalEntityCode;
  readonly familyId: string;
  readonly childId: string;
  readonly childName: string;
  readonly buyerName: string;
  readonly buyerAddress: string;
  readonly issueDate: string;
  readonly dueDate: string;
  readonly periodFrom: string;
  readonly periodTo: string;
  readonly lines: ReadonlyArray<InvoiceLine>;
  readonly total: Fenings;
}

/** One instalment of an IDSS payment plan. */
export interface PlanInstalment {
  readonly sequence: number;
  readonly dueDate: string;
  readonly amount: Fenings;
}

export type PaymentStatus = 'OPEN' | 'PARTIALLY_PAID' | 'PAID' | 'OVERPAID';

export interface PaymentSummary {
  readonly total: Fenings;
  readonly paid: Fenings;
  /** Still owed (never negative). */
  readonly open: Fenings;
  /** Overpayment kept as credit (never lost, BR-1 of D1). */
  readonly credit: Fenings;
  readonly status: PaymentStatus;
}

export const PAYMENT_STATUS_LABEL: Readonly<Record<PaymentStatus, string>> = {
  OPEN: 'Neplaćen',
  PARTIALLY_PAID: 'Djelimično plaćen',
  PAID: 'Plaćen',
  OVERPAID: 'Preplaćen',
};

export const MONTH_NAME: ReadonlyArray<string> = [
  'januar', 'februar', 'mart', 'april', 'maj', 'juni', 'juli', 'august', 'septembar', 'oktobar', 'novembar', 'decembar',
];
