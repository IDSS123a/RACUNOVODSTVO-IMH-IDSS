import type { Result } from '@/lib/tauri/invoke';
import { PricingError } from '@/features/billing/pricing';
import { listBoardRules, listBreakfast } from '@/features/board-rules/repository';
import { getFamily, listFamilies } from '@/features/families/repository';
import { listPriceItems } from '@/features/price-lists/repository';
import { buildImhMonthlyInvoices, InvoiceError, schoolYearOfMonth, type BoardDecision } from './domain';
import { countsAsMonthlyBilled } from './manual';
import { familyPreview, type PreviewInvoice } from './monthly';
import { buildIdssMonthlyInvoices } from './plans';
import { issueInvoices, listBilledOneTime, listInvoices, listPaymentPlans, type InvoiceDraftPayload } from './repository';
import type { BillingMonth } from './types';

/**
 * Application layer: prepare and issue the monthly invoices of IMH and IDSS (BR-26).
 * Preparing is read-only (the preview the operator confirms and adjusts); issuing happens in one backend transaction.
 */

export interface MonthlyPreview {
  readonly invoices: PreviewInvoice[];
  /** Families or children that could not be billed, with the reason (never silently skipped — E-5). */
  readonly problems: ReadonlyArray<{ familyName: string; reason: string }>;
  /**
   * Children with no enrolment in the school year of the month, so no invoice is proposed for them. Imported children
   * are among them until their enrolment is entered: the old workbook has no program and no date of birth (E-5).
   */
  readonly withoutEnrolment: ReadonlyArray<{ familyName: string; childName: string; importReview: boolean }>;
}

/**
 * Build the monthly invoices for every family — one invoice per child with everything due for it (BR-27; Director,
 * 2026-11-21): IMH tuition from the price list, IDSS plan instalments due in the month plus breakfast in the months
 * the board decided, and the one-time items of the enrolment not billed yet.
 * Board decisions: none are recorded yet (decision register arrives with Sprint 04), so the list is empty.
 */
export async function prepareMonth(month: BillingMonth, issueDate: string): Promise<Result<MonthlyPreview>> {
  const schoolYear = schoolYearOfMonth(month);
  const [families, prices, plans, rules, breakfast, existing, billedOneTime] = await Promise.all([
    listFamilies(),
    listPriceItems(schoolYear),
    listPaymentPlans(schoolYear),
    listBoardRules(schoolYear),
    listBreakfast(schoolYear),
    listInvoices({ entity: null, month }),
    listBilledOneTime(schoolYear),
  ]);
  if (!families.success) return families;
  if (!prices.success) return prices;
  if (!plans.success) return plans;
  if (!rules.success) return rules;
  if (!breakfast.success) return breakfast;
  if (!existing.success) return existing;
  if (!billedOneTime.success) return billedOneTime;
  // A child already invoiced for this month (e.g. by the old solution, imported — BR-32) is not billed twice;
  // a manual invoice for a child not enrolled does not count.
  const billed = new Set(existing.data.filter(countsAsMonthlyBilled).map((i) => `${i.entity}|${i.childId}`));
  const idssContext = {
    priceItems: prices.data,
    rules: rules.data.find((r) => r.entity === 'IDSS') ?? null,
    breakfast: new Set(breakfast.data),
  };
  const decisions: BoardDecision[] = [];
  const invoices: PreviewInvoice[] = [];
  const problems: { familyName: string; reason: string }[] = [];
  const withoutEnrolment: { familyName: string; childName: string; importReview: boolean }[] = [];

  for (const summary of families.data) {
    const detail = await getFamily(summary.id);
    if (!detail.success) {
      problems.push({ familyName: summary.displayName, reason: detail.error });
      continue;
    }
    for (const child of detail.data.children) {
      if (!detail.data.enrolments.some((e) => e.childId === child.id && e.schoolYear === schoolYear)) {
        withoutEnrolment.push({ familyName: summary.displayName, childName: `${child.firstName} ${child.lastName}`, importReview: child.importReview });
      }
    }
    try {
      const imh = buildImhMonthlyInvoices(detail.data, prices.data, decisions, month, issueDate);
      const idss = buildIdssMonthlyInvoices(detail.data, plans.data, idssContext, month, issueDate);
      for (const reason of idss.problems) problems.push({ familyName: summary.displayName, reason });
      const family = familyPreview(detail.data, imh, idss.drafts, prices.data, plans.data, billedOneTime.data, month, issueDate);
      for (const reason of family.problems) problems.push({ familyName: summary.displayName, reason });
      invoices.push(...family.previews);
    } catch (error: unknown) {
      if (error instanceof InvoiceError || error instanceof PricingError) {
        problems.push({ familyName: summary.displayName, reason: error.message });
      } else throw error;
    }
  }
  const fresh = invoices.filter((invoice) => {
    const { entity, childId, childName, buyerName } = invoice.header;
    if (!billed.has(`${entity}|${childId}`)) return true;
    problems.push({ familyName: buyerName, reason: `${childName}: već ima ${entity} račun za ovaj mjesec (npr. uvezen iz Excela) — nije uključeno` });
    return false;
  });
  fresh.sort((a, b) => a.header.entity.localeCompare(b.header.entity));
  return { success: true, data: { invoices: fresh, problems, withoutEnrolment } };
}

/** Issue the approved drafts; returns the invoice numbers. */
export function issueMonthlyInvoices(drafts: InvoiceDraftPayload[]): Promise<Result<string[]>> {
  return issueInvoices(drafts);
}
