import { ACTIVE_STATUSES } from '@/features/families/domain';
import type { Enrolment, FamilyDetail } from '@/features/families/types';
import { PROGRAM_ENTITY, type LegalEntityCode, type PriceListItem } from '@/features/price-lists/types';
import { monthBounds, schoolYearOfMonth } from './domain';
import { buildEnrolmentFeeInvoice } from './enrolment-fees';
import { oneTimeLines, type PreviewInvoice } from './monthly';
import type { PaymentPlan } from './plans';
import type { BilledOneTime } from './repository';
import type { BillingMonth } from './types';

/**
 * „Novi račun“ for one child (Director, 2026-11-21: „Zašto je sve ovako komplikovano?“). The operator picks the child;
 * the system recognizes what is due and proposes the invoice — nothing is typed for price-list items:
 * - MONTHLY: the child attends in the chosen month → its one monthly invoice with everything due (as „Mjesečni računi“);
 * - ENROLMENT: the child is enrolled for a LATER period (e.g. the next school year) → the enrolment invoice now:
 *   enrolment fee, materials, deposit by the rules, due as BR-9 / BR-10 say (they are paid before the child starts,
 *   when no monthly invoice exists yet);
 * - MANUAL: the child is not enrolled in the institution → a temporary service (summer school …), DL-P014.
 */

export type NewInvoiceMode =
  | { readonly mode: 'MONTHLY'; readonly enrolment: Enrolment }
  | { readonly mode: 'ENROLMENT'; readonly enrolment: Enrolment }
  | { readonly mode: 'MANUAL' };

/** Which invoice a child gets in this institution for this month. */
export function newInvoiceMode(detail: FamilyDetail, childId: string, entity: LegalEntityCode, month: BillingMonth): NewInvoiceMode {
  const { from, to } = monthBounds(month);
  const schoolYear = schoolYearOfMonth(month);
  const own = detail.enrolments.filter((e) => e.childId === childId && PROGRAM_ENTITY[e.program] === entity && ACTIVE_STATUSES.has(e.status));
  const current = own.find((e) => e.schoolYear === schoolYear && e.startsOn <= to && (e.endsOn === null || e.endsOn >= from));
  if (current) return { mode: 'MONTHLY', enrolment: current };
  const later = own.filter((e) => e.startsOn > to).sort((a, b) => a.startsOn.localeCompare(b.startsOn))[0];
  if (later) return { mode: 'ENROLMENT', enrolment: later };
  return { mode: 'MANUAL' };
}

/** The institutions in which the child has a current or later enrolment (the choice is then not needed). */
export function entitiesOfChild(detail: FamilyDetail, childId: string): LegalEntityCode[] {
  return [...new Set(detail.enrolments.filter((e) => e.childId === childId && ACTIVE_STATUSES.has(e.status)).map((e) => PROGRAM_ENTITY[e.program]))];
}

/**
 * The enrolment invoice for an enrolment that starts later: its one-time items not billed yet, the header (period =
 * the school year, due date by BR-9 / BR-10) from the enrolment-fee rules. Null when nothing is left to bill.
 */
export function enrolmentPreview(
  detail: FamilyDetail,
  priceItems: ReadonlyArray<PriceListItem>,
  plans: ReadonlyArray<PaymentPlan>,
  enrolment: Enrolment,
  billed: ReadonlyArray<BilledOneTime>,
  issueDate: string,
): PreviewInvoice | null {
  const { lines, notes } = oneTimeLines(detail, priceItems, plans, enrolment, billed, issueDate);
  if (lines.length === 0) return null;
  const entity = PROGRAM_ENTITY[enrolment.program];
  const tuitionPlan = plans.find((p) => p.enrolmentId === enrolment.id && p.itemCode === 'TUITION');
  const idssDeposit = entity === 'IDSS' && tuitionPlan !== undefined && tuitionPlan.instalments >= 2;
  const { draft } = buildEnrolmentFeeInvoice(detail, priceItems, plans, enrolment.id, { idssDeposit }, issueDate);
  return {
    key: `enrolment-${enrolment.id}`,
    kind: 'ENROLMENT_FEES',
    header: {
      entity: draft.entity,
      familyId: draft.familyId,
      childId: draft.childId,
      childName: draft.childName,
      buyerName: draft.buyerName,
      buyerAddress: draft.buyerAddress,
      issueDate: draft.issueDate,
      dueDate: draft.dueDate,
      periodFrom: draft.periodFrom,
      periodTo: draft.periodTo,
    },
    lines,
    notes,
    reason: '',
    included: true,
  };
}
