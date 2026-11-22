import type { Result } from '@/lib/tauri/invoke';
import { PricingError } from '@/features/billing/pricing';
import { listBoardRules, listBreakfast } from '@/features/board-rules/repository';
import { getFamily, listFamilies } from '@/features/families/repository';
import { listPriceItems } from '@/features/price-lists/repository';
import { ACTIVE_STATUSES } from '@/features/families/domain';
import { lastEntityByChild } from '@/features/families/bulk-enrolment';
import { childBelongsTo, familyBelongsTo, institutionsOfChild } from '@/features/families/membership';
import type { FamilyDetail } from '@/features/families/types';
import { PROGRAM_ENTITY, type LegalEntityCode } from '@/features/price-lists/types';
import { buildImhMonthlyInvoices, InvoiceError, monthBounds, schoolYearOfMonth, type BoardDecision } from './domain';
import { countsAsMonthlyBilled } from './manual';
import { familyPreview, type PreviewInvoice } from './monthly';
import { buildIdssMonthlyInvoices, defaultIdssPlan, type PaymentPlan } from './plans';
import { issueInvoices, listBilledOneTime, listInvoices, listPaymentPlans, savePaymentPlan, type InvoiceDraftPayload } from './repository';
import type { BillingMonth } from './types';

/**
 * Application layer: prepare and issue the monthly invoices of IMH and IDSS (BR-26).
 * Preparing is read-only (the preview the operator confirms and adjusts); issuing happens in one backend transaction.
 */

export interface MonthlyPreview {
  readonly invoices: PreviewInvoice[];
  /**
   * Families or children that could not be billed, with the reason (never silently skipped — E-5). `entity` names the
   * institution the problem belongs to, so each institution's flow shows only its own; null = not known (shown in both).
   */
  readonly problems: ReadonlyArray<{ familyName: string; reason: string; entity: LegalEntityCode | null }>;
  /**
   * Children with no enrolment in the school year of the month, so no invoice is proposed for them. Imported children
   * are among them until their enrolment is entered: the old workbook has no program and no date of birth (E-5).
   */
  readonly withoutEnrolment: ReadonlyArray<{ familyName: string; childName: string; importReview: boolean; entity: LegalEntityCode | null }>;
  /** IDSS pupils of the month without a tuition plan, with the plan the system proposes for the operator to approve. */
  readonly planProposals: ReadonlyArray<PlanProposal>;
}

export interface PlanProposal {
  readonly familyName: string;
  readonly childName: string;
  readonly plan: PaymentPlan;
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
  // the institution a child without an enrolment belongs to, from its latest invoice (imported ones included)
  const allInvoices = await listInvoices({ entity: null, month: null });
  if (!allInvoices.success) return allInvoices;
  const lastEntity = lastEntityByChild(allInvoices.data);
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
  const problems: { familyName: string; reason: string; entity: LegalEntityCode | null }[] = [];
  const withoutEnrolment: { familyName: string; childName: string; importReview: boolean; entity: LegalEntityCode | null }[] = [];
  const planProposals: PlanProposal[] = [];
  const idssDeadline = rules.data.find((r) => r.entity === 'IDSS')?.lastInstalmentBy ?? null;

  for (const summary of families.data) {
    const detail = await getFamily(summary.id);
    if (!detail.success) {
      problems.push({ familyName: summary.displayName, reason: detail.error, entity: null });
      continue;
    }
    for (const child of detail.data.children) {
      if (!detail.data.enrolments.some((e) => e.childId === child.id && e.schoolYear === schoolYear)) {
        withoutEnrolment.push({
          familyName: summary.displayName,
          childName: `${child.firstName} ${child.lastName}`,
          importReview: child.importReview,
          // same rule as every list of a flow (families/membership.ts)
          entity: institutionsOfChild(detail.data, child.id, lastEntity, schoolYear)[0] ?? null,
        });
      }
    }
    // each institution is built on its own, so a problem is attributed to the institution it belongs to
    let imh: ReturnType<typeof buildImhMonthlyInvoices> = [];
    try {
      imh = buildImhMonthlyInvoices(detail.data, prices.data, decisions, month, issueDate);
    } catch (error: unknown) {
      if (!(error instanceof InvoiceError || error instanceof PricingError)) throw error;
      problems.push({ familyName: summary.displayName, reason: error.message, entity: 'IMH' });
    }
    try {
      const idss = buildIdssMonthlyInvoices(detail.data, plans.data, idssContext, month, issueDate);
      // an IDSS pupil without a tuition plan gets the proposed plan to approve instead of only an error (Director, 2026-11-21)
      const { from, to } = monthBounds(month);
      const proposedFor = new Set<string>();
      for (const e of detail.data.enrolments) {
        const pupil = detail.data.children.find((c) => c.id === e.childId);
        const due = e.schoolYear === schoolYear && PROGRAM_ENTITY[e.program] === 'IDSS' && ACTIVE_STATUSES.has(e.status) && e.startsOn <= to && (e.endsOn === null || e.endsOn >= from);
        if (!pupil || !due || plans.data.some((p) => p.enrolmentId === e.id && p.itemCode === 'TUITION')) continue;
        try {
          const proposal = defaultIdssPlan(detail.data, prices.data, e.id, 'TUITION', idssDeadline);
          const name = `${pupil.firstName} ${pupil.lastName}`;
          planProposals.push({
            familyName: summary.displayName,
            childName: name,
            plan: {
              id: crypto.randomUUID(), enrolmentId: e.id, childId: pupil.id, itemCode: 'TUITION', instalments: proposal.instalments, total: proposal.total,
              items: proposal.items.map((i) => ({ ...i, invoiceId: null })),
            },
          });
          proposedFor.add(`${name}: nema plan plaćanja školarine (IDSS)`);
        } catch (error: unknown) {
          if (!(error instanceof InvoiceError || error instanceof PricingError)) throw error;
        }
      }
      for (const reason of idss.problems) if (!proposedFor.has(reason)) problems.push({ familyName: summary.displayName, reason, entity: 'IDSS' });
      const family = familyPreview(detail.data, imh, idss.drafts, prices.data, plans.data, billedOneTime.data, month, issueDate);
      for (const p of family.problems) problems.push({ familyName: summary.displayName, reason: p.text, entity: p.entity });
      invoices.push(...family.previews);
    } catch (error: unknown) {
      if (error instanceof InvoiceError || error instanceof PricingError) {
        problems.push({ familyName: summary.displayName, reason: error.message, entity: 'IDSS' });
      } else throw error;
    }
  }
  const fresh = invoices.filter((invoice) => {
    const { entity, childId, childName, buyerName } = invoice.header;
    if (!billed.has(`${entity}|${childId}`)) return true;
    problems.push({ familyName: buyerName, reason: `${childName}: već ima ${entity} račun za ovaj mjesec (npr. uvezen iz Excela) — nije uključeno`, entity });
    return false;
  });
  fresh.sort((a, b) => a.header.entity.localeCompare(b.header.entity));
  return { success: true, data: { invoices: fresh, problems, withoutEnrolment, planProposals } };
}

/** Save the proposed plans the operator approved; stops at the first refusal. Returns how many were saved. */
export async function acceptPlanProposals(proposals: ReadonlyArray<PlanProposal>): Promise<Result<number>> {
  for (const [index, proposal] of proposals.entries()) {
    const saved = await savePaymentPlan(proposal.plan);
    if (!saved.success) return { ...saved, error: `${proposal.childName}: ${saved.error} (sačuvano ${index} planova)` };
  }
  return { success: true, data: proposals.length };
}

/** Issue the approved drafts; returns the invoice numbers. */
export function issueMonthlyInvoices(drafts: InvoiceDraftPayload[]): Promise<Result<string[]>> {
  return issueInvoices(drafts);
}

/** The families and children of one institution's flow (rule in `@/features/families/membership`). */
export interface InstitutionFamilies {
  /** Families with at least one child of the institution, with all their data. */
  readonly families: FamilyDetail[];
  /** The children shown in this institution. */
  readonly childIds: ReadonlySet<string>;
}

/** Load the families of one institution for the lists of its flow; today's school year decides current enrolments. */
export async function loadInstitutionFamilies(entity: LegalEntityCode, onDate: string): Promise<Result<InstitutionFamilies>> {
  const schoolYear = schoolYearOfMonth(onDate.slice(0, 7) as BillingMonth);
  const [list, invoices] = await Promise.all([listFamilies(), listInvoices({ entity: null, month: null })]);
  if (!list.success) return list;
  if (!invoices.success) return invoices;
  const details = await Promise.all(list.data.map((f) => getFamily(f.id)));
  const failed = details.find((d) => !d.success);
  if (failed && !failed.success) return failed;
  const lastEntity = lastEntityByChild(invoices.data);
  const families: FamilyDetail[] = [];
  const childIds = new Set<string>();
  for (const result of details) {
    const detail = result.success ? result.data : null;
    if (!detail || !familyBelongsTo(detail, entity, lastEntity, schoolYear)) continue;
    families.push(detail);
    for (const child of detail.children) if (childBelongsTo(detail, child.id, entity, lastEntity, schoolYear)) childIds.add(child.id);
  }
  return { success: true, data: { families, childIds } };
}
