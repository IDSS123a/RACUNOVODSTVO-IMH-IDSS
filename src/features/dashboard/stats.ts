import { sum, type Fenings } from '@/features/billing/money';
import { ACTIVE_STATUSES } from '@/features/families/domain';
import { invoiceBalance } from '@/features/invoices/credit-notes';
import type { InvoiceSummary } from '@/features/invoices/repository';
import { PROGRAM_ENTITY, type LegalEntityCode } from '@/features/price-lists/types';
import type { EnrolmentOverview } from './repository';

/**
 * Dashboard figures (CONSTITUTION BR-29; specs/dashboard-audit D1–D8, document `vDash`). Pure and on the register's
 * one balance definition (`invoiceBalance`, M-7):
 * - credit-note documents and cancelled invoices are left out (a credit note acts through its invoice's net);
 * - overpaid counts as paid; amounts are after credit notes, as on the invoice (DL-P013 amendment 1).
 */

export type EntityFilter = LegalEntityCode | 'ALL';

export interface DashboardStats {
  readonly enrolments: { readonly IMH: number; readonly IDSS: number; readonly families: number };
  /** Nothing paid, something open. */
  readonly unpaid: { readonly count: number; readonly open: Fenings; readonly overdueCount: number; readonly overdue: Fenings };
  readonly partial: { readonly count: number; readonly paid: Fenings; readonly open: Fenings };
  /** Σ open of every counted invoice — equals „Otvoreno“ on Računi for the same filter. */
  readonly totalOpen: Fenings;
  /** Invoices ISSUED in the month: net amount and the three bar segments (paid + rest of partly paid + unpaid = net). */
  readonly month: {
    readonly count: number;
    readonly invoiced: Fenings;
    readonly paid: Fenings;
    readonly paidCount: number;
    readonly partialRest: Fenings;
    readonly partialCount: number;
    readonly unpaid: Fenings;
    readonly unpaidCount: number;
  };
  /** The most recently issued invoices (newest first). */
  readonly recent: ReadonlyArray<InvoiceSummary>;
}

export const RECENT_COUNT = 8;

/** Invoices that count: not a credit-note document, not cancelled, of the chosen institution. */
export function countedInvoices(invoices: ReadonlyArray<InvoiceSummary>, entity: EntityFilter): InvoiceSummary[] {
  return invoices.filter(
    (i) => i.kind !== 'CREDIT_NOTE' && i.status === 'ISSUED' && invoiceBalance(i).status !== 'CANCELLED' && (entity === 'ALL' || i.entity === entity),
  );
}

export function dashboardStats(
  invoices: ReadonlyArray<InvoiceSummary>,
  enrolments: ReadonlyArray<EnrolmentOverview>,
  options: { readonly entity: EntityFilter; readonly month: string; readonly today: string },
): DashboardStats {
  const { entity, month, today } = options;
  const counted = countedInvoices(invoices, entity);
  const balances = counted.map((invoice) => ({ invoice, balance: invoiceBalance(invoice) }));

  const unpaid = balances.filter((b) => b.balance.status === 'OPEN' && b.balance.open > 0);
  const overdue = unpaid.filter((b) => b.invoice.dueDate < today);
  const partial = balances.filter((b) => b.balance.status === 'PARTIALLY_PAID');

  const inMonth = balances.filter((b) => b.invoice.issueDate.slice(0, 7) === month);
  const fullyPaid = inMonth.filter((b) => b.balance.status === 'PAID' || b.balance.status === 'OVERPAID');
  const monthPartial = inMonth.filter((b) => b.balance.status === 'PARTIALLY_PAID');
  const monthUnpaid = inMonth.filter((b) => b.balance.status === 'OPEN');

  const active = enrolments.filter((e) => ACTIVE_STATUSES.has(e.status) && (entity === 'ALL' || PROGRAM_ENTITY[e.program] === entity));
  const recent = [...counted, ...invoices.filter((i) => i.kind === 'CREDIT_NOTE' && (entity === 'ALL' || i.entity === entity))]
    .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number))
    .slice(0, RECENT_COUNT);

  return {
    enrolments: {
      IMH: active.filter((e) => PROGRAM_ENTITY[e.program] === 'IMH').length,
      IDSS: active.filter((e) => PROGRAM_ENTITY[e.program] === 'IDSS').length,
      families: new Set(active.map((e) => e.familyId)).size,
    },
    unpaid: {
      count: unpaid.length,
      open: sum(unpaid.map((b) => b.balance.open)),
      overdueCount: overdue.length,
      overdue: sum(overdue.map((b) => b.balance.open)),
    },
    partial: {
      count: partial.length,
      paid: sum(partial.map((b) => b.balance.paid)),
      open: sum(partial.map((b) => b.balance.open)),
    },
    totalOpen: sum(balances.map((b) => b.balance.open)),
    month: {
      count: inMonth.length,
      invoiced: sum(inMonth.map((b) => b.balance.net)),
      // paid part of every invoice of the month, never more than its net (an overpayment is family credit)
      paid: sum(inMonth.map((b) => Math.min(b.balance.paid, b.balance.net))),
      paidCount: fullyPaid.length,
      partialRest: sum(monthPartial.map((b) => b.balance.open)),
      partialCount: monthPartial.length,
      unpaid: sum(monthUnpaid.map((b) => b.balance.open)),
      unpaidCount: monthUnpaid.length,
    },
    recent,
  };
}
