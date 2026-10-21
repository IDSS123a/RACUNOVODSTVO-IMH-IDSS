import type { Result } from '@/lib/tauri/invoke';
import { getFamily, listFamilies } from '@/features/families/repository';
import { listPriceItems } from '@/features/price-lists/repository';
import { buildImhMonthlyInvoice, InvoiceError, schoolYearOfMonth, type BoardDecision } from './domain';
import { issueInvoices, type InvoiceDraftPayload } from './repository';
import type { BillingMonth } from './types';
import { PricingError } from '@/features/billing/pricing';

/**
 * Application layer: prepare and issue the IMH monthly invoices.
 * Preparing is read-only (preview); issuing happens in one backend transaction.
 */

export interface MonthlyPreview {
  readonly drafts: InvoiceDraftPayload[];
  /** Families that could not be billed, with the reason (never silently skipped — E-5). */
  readonly problems: ReadonlyArray<{ familyName: string; reason: string }>;
}

/**
 * Build IMH monthly invoice drafts for every family with a child in IMH that month.
 * Board decisions: none are recorded yet (decision register arrives with Sprint 04), so the list is empty.
 */
export async function prepareImhMonth(month: BillingMonth, issueDate: string): Promise<Result<MonthlyPreview>> {
  const [families, prices] = await Promise.all([listFamilies(), listPriceItems(schoolYearOfMonth(month))]);
  if (!families.success) return families;
  if (!prices.success) return prices;
  const decisions: BoardDecision[] = [];
  const drafts: InvoiceDraftPayload[] = [];
  const problems: { familyName: string; reason: string }[] = [];

  for (const summary of families.data) {
    const detail = await getFamily(summary.id);
    if (!detail.success) {
      problems.push({ familyName: summary.displayName, reason: detail.error });
      continue;
    }
    try {
      const draft = buildImhMonthlyInvoice(detail.data, prices.data, decisions, month, issueDate);
      if (draft) drafts.push({ ...draft, id: crypto.randomUUID(), kind: 'MONTHLY', lines: [...draft.lines] });
    } catch (error: unknown) {
      if (error instanceof InvoiceError || error instanceof PricingError) {
        problems.push({ familyName: summary.displayName, reason: error.message });
      } else throw error;
    }
  }
  return { success: true, data: { drafts, problems } };
}

/** Issue the previewed drafts; returns the invoice numbers. */
export function issueMonthlyInvoices(drafts: InvoiceDraftPayload[]): Promise<Result<string[]>> {
  return issueInvoices(drafts);
}
