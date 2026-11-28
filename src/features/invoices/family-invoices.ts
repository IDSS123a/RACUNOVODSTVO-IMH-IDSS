import { invoiceBalance, type InvoiceBalance } from './credit-notes';
import type { InvoiceSummary } from './repository';

/**
 * A child's invoices on the family card (Director, 2026-11-28: „dodaj spisak računa … operater se mora lagano i
 * logično kretati kroz cijelu aplikaciju“). One institution, one child; each invoice with the credit notes that
 * cancel it and its balance (credit-notes.ts, one definition, M-7). Newest first.
 */
export interface ChildInvoiceRow {
  readonly invoice: InvoiceSummary;
  readonly creditNotes: ReadonlyArray<InvoiceSummary>;
  readonly balance: InvoiceBalance;
}

export function childInvoices(
  invoices: ReadonlyArray<InvoiceSummary>,
  familyId: string,
  entity: string,
  childId: string | null,
): ChildInvoiceRow[] {
  const own = invoices.filter((i) => i.familyId === familyId && i.entity === entity && i.childId === (childId ?? ''));
  return own
    .filter((i) => i.kind !== 'CREDIT_NOTE')
    .sort((a, b) => b.issueDate.localeCompare(a.issueDate) || b.number.localeCompare(a.number))
    .map((invoice) => ({
      invoice,
      creditNotes: invoices.filter((c) => c.kind === 'CREDIT_NOTE' && c.creditsInvoiceId === invoice.id),
      balance: invoiceBalance(invoice),
    }));
}

/** „Računi: 6 · otvoreno 4 (1.830,00 KM)“ — counts for the heading; the amount is formatted by the caller. */
export function openSummary(rows: ReadonlyArray<ChildInvoiceRow>): { count: number; open: number; openAmount: number } {
  const open = rows.filter((r) => r.balance.open > 0 && r.invoice.status === 'ISSUED');
  return { count: rows.length, open: open.length, openAmount: open.reduce((s, r) => s + r.balance.open, 0) };
}
