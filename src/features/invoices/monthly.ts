import { sum, type Fenings } from '@/features/billing/money';
import { PricingError } from '@/features/billing/pricing';
import { ACTIVE_STATUSES } from '@/features/families/domain';
import type { Enrolment, FamilyDetail } from '@/features/families/types';
import { PROGRAM_ENTITY, type LegalEntityCode, type PriceListItem } from '@/features/price-lists/types';
import { dueDateForMonth, InvoiceError, monthBounds, schoolYearOfMonth } from './domain';
import { buildEnrolmentFeeInvoice } from './enrolment-fees';
import type { ManualUnit } from './manual';
import type { PaymentPlan, PlanItemRef } from './plans';
import type { BilledOneTime, InvoiceDraftPayload } from './repository';
import type { BillingMonth, InvoiceDraft, InvoiceLine } from './types';

/**
 * One invoice per child (Director, 2026-11-21; specs/one-invoice-per-child): the child's monthly invoice carries
 * everything due for that child — tuition (IDSS: plan instalments, breakfast) and, while not yet billed, the one-time
 * items of the enrolment (enrolment fee, materials, deposit) by the rules of BR-9 / BR-10.
 * The operator confirms every proposed invoice and decides what it shows: any line can be left out (a one-time item
 * left out is proposed again next month), and a service outside the price list can be added with its basis.
 * Price-list amounts are never edited here (BR-7).
 */

export interface PreviewLine {
  readonly key: string;
  readonly line: InvoiceLine;
  /** On the invoice when issued. */
  readonly selected: boolean;
  /** Why the operator should look at this line, if anything. */
  readonly note: string | null;
  /** The IDSS plan instalment this line bills, marked invoiced when issued. */
  readonly planItem: PlanItemRef | null;
}

export interface PreviewInvoice {
  readonly key: string;
  readonly kind: 'MONTHLY' | 'INSTALMENT' | 'ENROLMENT_FEES';
  /** Header of the draft; lines and total come from `lines`. */
  readonly header: Omit<InvoiceDraft, 'lines' | 'total'>;
  readonly lines: ReadonlyArray<PreviewLine>;
  /** Rules applied to the one-time items (e.g. „Upisnina se ne naplaćuje: …“). */
  readonly notes: ReadonlyArray<string>;
  /** Basis of the services outside the price list added by the operator (required when there is one). */
  readonly reason: string;
  /** Issued at all. */
  readonly included: boolean;
}

const ONE_TIME_GROUP: Readonly<Record<string, string>> = {
  ENROLMENT_FEE: 'ENROLMENT_FEE',
  ENROLMENT_FEE_AFTER_IDSS_PRESCHOOL: 'ENROLMENT_FEE',
  MATERIALS: 'MATERIALS',
  DEPOSIT: 'DEPOSIT',
};

const ONE_TIME_LABEL: Readonly<Record<string, string>> = { ENROLMENT_FEE: 'upisninu', MATERIALS: 'materijal', DEPOSIT: 'depozit' };

let counter = 0;
const nextKey = (): string => `k${(counter += 1)}`;

/** The enrolments of the institution that cover at least one day of the month (as the monthly builders use). */
function enrolmentsInMonth(detail: FamilyDetail, month: BillingMonth): Enrolment[] {
  const { from, to } = monthBounds(month);
  const schoolYear = schoolYearOfMonth(month);
  return detail.enrolments.filter(
    (e) => e.schoolYear === schoolYear && ACTIVE_STATUSES.has(e.status) && e.startsOn <= to && (e.endsOn === null || e.endsOn >= from),
  );
}

/**
 * The one-time lines still to bill for an enrolment, by the enrolment-fee rules (continuing child, transfer, sibling
 * tier of the deposit). Items already on an issued invoice of this enrolment are left out. An item found on an
 * imported invoice of the old workbook (which has no enrolment) is proposed but NOT selected, with a note naming that
 * invoice. The IDSS deposit is proposed only with an instalment plan and not selected (it is the school's decision).
 */
export function oneTimeLines(
  detail: FamilyDetail,
  priceItems: ReadonlyArray<PriceListItem>,
  plans: ReadonlyArray<PaymentPlan>,
  enrolment: Enrolment,
  billed: ReadonlyArray<BilledOneTime>,
  issueDate: string,
): { lines: PreviewLine[]; notes: string[] } {
  const entity = PROGRAM_ENTITY[enrolment.program];
  const tuitionPlan = plans.find((p) => p.enrolmentId === enrolment.id && p.itemCode === 'TUITION');
  const idssDeposit = entity === 'IDSS' && tuitionPlan !== undefined && tuitionPlan.instalments >= 2;
  let proposal: ReturnType<typeof buildEnrolmentFeeInvoice>;
  try {
    proposal = buildEnrolmentFeeInvoice(detail, priceItems, plans, enrolment.id, { idssDeposit }, issueDate);
  } catch (error: unknown) {
    // nothing to bill (e.g. a continuing IDSS pupil) is not a problem; a missing price is reported by the caller
    if (error instanceof InvoiceError && error.message.includes('nema upisnih troškova')) return { lines: [], notes: [] };
    throw error;
  }
  const ownBilled = new Set(billed.filter((b) => b.enrolmentId === enrolment.id).map((b) => ONE_TIME_GROUP[b.itemCode]));
  const legacy = billed.filter((b) => b.enrolmentId === null && b.childId === enrolment.childId && b.entity === entity);
  const lines: PreviewLine[] = [];
  for (const line of proposal.draft.lines) {
    const group = ONE_TIME_GROUP[line.itemCode];
    if (group === undefined || ownBilled.has(group)) continue;
    const old = legacy.find((b) => ONE_TIME_GROUP[b.itemCode] === group);
    const isIdssDeposit = entity === 'IDSS' && group === 'DEPOSIT';
    const note = old
      ? `Uvezeni račun ${old.invoiceNumber} (${old.issueDate}) već sadrži ${ONE_TIME_LABEL[group] ?? group} — provjerite prije uključivanja.`
      : isIdssDeposit
        ? 'Depozit IDSS samo na odluku škole, uz plaćanje školarine na rate.'
        : null;
    lines.push({ key: nextKey(), line, selected: !old && !isIdssDeposit, note, planItem: null });
  }
  return { lines, notes: lines.length > 0 ? [...proposal.notes] : [] };
}

/**
 * Turn the monthly drafts of one family into preview invoices and add the one-time items of every enrolment of the
 * month. A child with one-time items but no monthly draft (e.g. an IDSS pupil with no instalment due) gets an invoice
 * with those items only.
 */
export function familyPreview(
  detail: FamilyDetail,
  imhDrafts: ReadonlyArray<InvoiceDraft>,
  idssDrafts: ReadonlyArray<InvoiceDraft & { planItems: PlanItemRef[] }>,
  priceItems: ReadonlyArray<PriceListItem>,
  plans: ReadonlyArray<PaymentPlan>,
  billed: ReadonlyArray<BilledOneTime>,
  month: BillingMonth,
  issueDate: string,
): { previews: PreviewInvoice[]; problems: Array<{ entity: LegalEntityCode; text: string }> } {
  const previews: PreviewInvoice[] = [];
  const problems: Array<{ entity: LegalEntityCode; text: string }> = [];
  const toPreview = (draft: InvoiceDraft, kind: PreviewInvoice['kind'], planItems: ReadonlyArray<PlanItemRef>): PreviewInvoice => {
    const { lines } = draft;
    const header: PreviewInvoice['header'] = {
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
    };
    return {
      key: nextKey(),
      kind,
      header,
      // IDSS: the first lines bill the plan instalments, in the order of `planItems` (buildIdssMonthlyInvoices)
      lines: lines.map((line, index) => ({ key: nextKey(), line, selected: true, note: null, planItem: planItems[index] ?? null })),
      notes: [],
      reason: '',
      included: true,
    };
  };
  for (const draft of imhDrafts) previews.push(toPreview(draft, 'MONTHLY', []));
  for (const draft of idssDrafts) previews.push(toPreview(draft, 'INSTALMENT', draft.planItems));

  const buyer = detail.guardians.find((g) => g.isPayer);
  const { from, to } = monthBounds(month);
  for (const enrolment of enrolmentsInMonth(detail, month)) {
    const entity = PROGRAM_ENTITY[enrolment.program];
    const child = detail.children.find((c) => c.id === enrolment.childId);
    if (!child) continue;
    let extra: ReturnType<typeof oneTimeLines>;
    try {
      extra = oneTimeLines(detail, priceItems, plans, enrolment, billed, issueDate);
    } catch (error: unknown) {
      if (error instanceof InvoiceError || error instanceof PricingError) {
        problems.push({ entity, text: `${child.firstName} ${child.lastName}: jednokratni troškovi — ${error.message}` });
        continue;
      }
      throw error;
    }
    if (extra.lines.length === 0) continue;
    const index = previews.findIndex((p) => p.header.childId === child.id && p.header.entity === entity);
    const existing = previews[index];
    if (existing) {
      previews[index] = { ...existing, lines: [...existing.lines, ...extra.lines], notes: [...existing.notes, ...extra.notes] };
    } else if (buyer) {
      previews.push({
        key: nextKey(),
        kind: entity === 'IMH' ? 'MONTHLY' : 'INSTALMENT',
        header: {
          entity,
          familyId: detail.family.id,
          childId: child.id,
          childName: `${child.firstName} ${child.lastName}`,
          buyerName: buyer.fullName,
          buyerAddress: detail.family.address,
          issueDate,
          dueDate: dueDateForMonth(month, issueDate),
          periodFrom: from,
          periodTo: to,
        },
        lines: extra.lines,
        notes: extra.notes,
        reason: '',
        included: true,
      });
    }
  }
  return { previews, problems };
}

/** A service outside the price list, added by the operator to a child's monthly invoice. */
export function extraServiceLine(
  preview: PreviewInvoice,
  input: { readonly description: string; readonly unit: ManualUnit; readonly quantity: number; readonly unitPrice: Fenings },
): PreviewLine {
  const anchor = preview.lines.find((l) => l.line.enrolmentId !== '');
  if (!anchor) throw new InvoiceError('račun nema upis za koji bi se dodala usluga');
  const total = input.quantity * input.unitPrice;
  return {
    key: nextKey(),
    selected: true,
    note: null,
    planItem: null,
    line: {
      itemCode: 'OTHER',
      description: input.description.trim(),
      childId: preview.header.childId,
      enrolmentId: anchor.line.enrolmentId,
      program: anchor.line.program,
      listAmount: total,
      boardDecisionId: null,
      amount: total,
      quantity: input.quantity,
      unit: input.unit,
    },
  };
}

/** Total of the selected lines. */
export function previewTotal(preview: PreviewInvoice): Fenings {
  return sum(preview.lines.filter((l) => l.selected).map((l) => l.line.amount));
}

/** Why an included preview cannot be issued, or null. */
export function previewProblem(preview: PreviewInvoice): string | null {
  if (!preview.included) return null;
  const selected = preview.lines.filter((l) => l.selected);
  if (selected.length === 0) return 'nijedna stavka nije odabrana';
  if (selected.some((l) => l.line.itemCode === 'OTHER') && !preview.reason.trim()) return 'unesite osnov za uslugu van cjenovnika';
  return null;
}

/** The drafts to issue: included previews with their selected lines; plan instalments only for selected lines. */
export function finalDrafts(previews: ReadonlyArray<PreviewInvoice>): InvoiceDraftPayload[] {
  return previews
    .filter((p) => p.included && previewProblem(p) === null)
    .map((p) => {
      const selected = p.lines.filter((l) => l.selected);
      return {
        ...p.header,
        id: crypto.randomUUID(),
        kind: p.kind,
        lines: selected.map((l) => l.line),
        total: sum(selected.map((l) => l.line.amount)),
        planItems: selected.flatMap((l) => (l.planItem ? [l.planItem] : [])),
        reason: p.reason.trim(),
      };
    });
}
