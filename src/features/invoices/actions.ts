import type { Result } from '@/lib/tauri/invoke';
import { PricingError } from '@/features/billing/pricing';
import { getFamily, listFamilies } from '@/features/families/repository';
import { listPriceItems } from '@/features/price-lists/repository';
import { buildImhMonthlyInvoices, InvoiceError, schoolYearOfMonth, type BoardDecision } from './domain';
import { buildIdssMonthlyInvoices } from './plans';
import { issueInvoices, listPaymentPlans, type InvoiceDraftPayload } from './repository';
import type { BillingMonth } from './types';

/**
 * Application layer: prepare and issue the monthly invoices of IMH and IDSS (BR-26).
 * Preparing is read-only (the preview the operator approves); issuing happens in one backend transaction.
 */

export interface MonthlyPreview {
  readonly drafts: InvoiceDraftPayload[];
  /** Families or children that could not be billed, with the reason (never silently skipped — E-5). */
  readonly problems: ReadonlyArray<{ familyName: string; reason: string }>;
}

/**
 * Build the monthly drafts for every family — one invoice per child (BR-27):
 * IMH from the price list, IDSS from the instalments of the payment plans due in the month.
 * Board decisions: none are recorded yet (decision register arrives with Sprint 04), so the list is empty.
 */
export async function prepareMonth(month: BillingMonth, issueDate: string): Promise<Result<MonthlyPreview>> {
  const schoolYear = schoolYearOfMonth(month);
  const [families, prices, plans] = await Promise.all([listFamilies(), listPriceItems(schoolYear), listPaymentPlans(schoolYear)]);
  if (!families.success) return families;
  if (!prices.success) return prices;
  if (!plans.success) return plans;
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
      for (const draft of buildImhMonthlyInvoices(detail.data, prices.data, decisions, month, issueDate)) {
        drafts.push({ ...draft, id: crypto.randomUUID(), kind: 'MONTHLY', lines: [...draft.lines], planItems: [] });
      }
      const idss = buildIdssMonthlyInvoices(detail.data, plans.data, month, issueDate);
      for (const draft of idss.drafts) {
        drafts.push({ ...draft, id: crypto.randomUUID(), kind: 'INSTALMENT', lines: [...draft.lines] });
      }
      for (const reason of idss.problems) problems.push({ familyName: summary.displayName, reason });
    } catch (error: unknown) {
      if (error instanceof InvoiceError || error instanceof PricingError) {
        problems.push({ familyName: summary.displayName, reason: error.message });
      } else throw error;
    }
  }
  drafts.sort((a, b) => a.entity.localeCompare(b.entity));
  return { success: true, data: { drafts, problems } };
}

/** Issue the approved drafts; returns the invoice numbers. */
export function issueMonthlyInvoices(drafts: InvoiceDraftPayload[]): Promise<Result<string[]>> {
  return issueInvoices(drafts);
}
