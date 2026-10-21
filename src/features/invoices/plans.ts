import { IDSS_TUITION_MONTHS } from '@/constants';
import { prorate, sum } from '@/features/billing/money';
import { assignSiblingTiers, findPrice, remainingTuitionMonths, tuitionForYear } from '@/features/billing/pricing';
import type { BoardBillingRules } from '@/features/board-rules/types';
import { ACTIVE_STATUSES } from '@/features/families/domain';
import type { Child, FamilyDetail } from '@/features/families/types';
import { ITEM_LABEL, PROGRAM_ENTITY, PROGRAM_LABEL, type PriceListItem, type SchoolYear } from '@/features/price-lists/types';
import { dueDateForMonth, InvoiceError, monthBounds, monthLabel, schoolYearOfMonth, splitIntoInstalments } from './domain';
import type { BillingMonth, InvoiceDraft, InvoiceLine, PlanInstalment } from './types';

/**
 * IDSS payment plans (BR-11, BR-12) and the monthly IDSS invoices built from them (BR-26, BR-27).
 * Pure functions, unit-tested. Amounts come only from the price list via the pricing engine.
 */

/** Items that are paid by an IDSS payment plan. */
export type PlanItemCode = 'TUITION' | 'EXTENDED_STAY';

/** Maximum instalments per item (BR-11: tuition 1–12, extended stay up to 10). */
export const MAX_INSTALMENTS: Readonly<Record<PlanItemCode, number>> = { TUITION: 12, EXTENDED_STAY: 10 };

export interface PlanItem extends PlanInstalment {
  /** Invoice that billed this instalment; null while not yet invoiced. */
  readonly invoiceId: string | null;
}

export interface PaymentPlan {
  readonly id: string;
  readonly enrolmentId: string;
  readonly childId: string;
  readonly itemCode: PlanItemCode;
  readonly instalments: number;
  readonly total: number;
  readonly items: ReadonlyArray<PlanItem>;
}

/** A reference from an invoice to the plan instalment it bills (marks it invoiced, never twice). */
export interface PlanItemRef {
  readonly planId: string;
  readonly sequence: number;
}

function childName(child: Child): string {
  return `${child.firstName} ${child.lastName}`;
}

/**
 * Propose a payment plan for one IDSS enrolment.
 * - Tuition: annual price by sibling tier within IDSS (BR-6), pro-rata from the start month (BR-12).
 * - Extended stay: annual price, no sibling discount, pro-rata on a mid-year start.
 * The first instalment falls in the start month; every instalment is due on the 5th.
 * @param lastInstalmentBy latest due date decided by the board; null = not decided, nothing enforced
 */
export function proposeIdssPlan(
  detail: FamilyDetail,
  priceItems: ReadonlyArray<PriceListItem>,
  enrolmentId: string,
  itemCode: PlanItemCode,
  instalments: number,
  lastInstalmentBy: string | null,
): { total: number; items: PlanInstalment[] } {
  const enrolment = detail.enrolments.find((e) => e.id === enrolmentId);
  if (!enrolment) throw new InvoiceError('upis nije pronađen');
  if (PROGRAM_ENTITY[enrolment.program] !== 'IDSS') throw new InvoiceError('plan plaćanja postoji samo za školu IDSS');
  if (!ACTIVE_STATUSES.has(enrolment.status)) throw new InvoiceError('plan se pravi samo za aktivan upis');
  const child = detail.children.find((c) => c.id === enrolment.childId);
  if (!child) throw new InvoiceError('dijete nije pronađeno');
  const max = MAX_INSTALMENTS[itemCode];
  if (!Number.isInteger(instalments) || instalments < 1 || instalments > max) {
    throw new InvoiceError(`broj rata za ${ITEM_LABEL[itemCode].toLowerCase()} mora biti od 1 do ${max}`);
  }

  const schoolYear = enrolment.schoolYear as SchoolYear;
  const startMonth = Number(enrolment.startsOn.slice(5, 7));
  let total: number;
  if (itemCode === 'TUITION') {
    const siblings = detail.enrolments.filter(
      (e) => e.schoolYear === enrolment.schoolYear && PROGRAM_ENTITY[e.program] === 'IDSS' && ACTIVE_STATUSES.has(e.status),
    );
    const births = new Map(detail.children.map((c) => [c.id, c.dateOfBirth]));
    const tiers = assignSiblingTiers(siblings.map((e) => ({ childId: e.childId, dateOfBirth: births.get(e.childId) ?? '', program: e.program })));
    const row = findPrice(priceItems, {
      schoolYear,
      program: enrolment.program,
      item: 'TUITION',
      residency: child.residency,
      tier: tiers.get(child.id) ?? 'FIRST',
    });
    total = tuitionForYear(row, startMonth);
  } else {
    const row = findPrice(priceItems, {
      schoolYear,
      program: enrolment.program,
      item: 'EXTENDED_STAY',
      residency: child.residency,
      tier: 'ANY',
    });
    if (row.basis !== 'ANNUAL') throw new InvoiceError('produženi boravak mora biti godišnja cijena');
    total = prorate(row.amount, remainingTuitionMonths('IDSS', startMonth), IDSS_TUITION_MONTHS);
  }

  const firstMonth = enrolment.startsOn.slice(0, 7) as BillingMonth;
  const items = splitIntoInstalments(total, instalments, firstMonth);
  if (lastInstalmentBy !== null) {
    const allowed = items.filter((i) => i.dueDate <= lastInstalmentBy).length;
    if (allowed < items.length) {
      throw new InvoiceError(`prema odluci Školskog odbora (rok ${lastInstalmentBy}) uz početak u ${monthLabel(firstMonth)} najviše je ${allowed} rata`);
    }
  }
  return { total, items };
}

/** What IDSS monthly billing needs besides the family and its plans. */
export interface IdssBillingContext {
  readonly priceItems: ReadonlyArray<PriceListItem>;
  /** ŠO IDSS rules for the school year of the month; null when none were entered. */
  readonly rules: BoardBillingRules | null;
  /** Enrolment ids with breakfast. */
  readonly breakfast: ReadonlySet<string>;
}

/**
 * Monthly IDSS invoices for one family: one invoice per child (BR-27) with
 * - every plan instalment due in the month that is not invoiced yet;
 * - breakfast, when the child has it and the board decided this month is billed.
 * A child without a tuition plan, or with breakfast while the board months are not entered,
 * is reported as a problem, never silently skipped (E-5).
 */
export function buildIdssMonthlyInvoices(
  detail: FamilyDetail,
  plans: ReadonlyArray<PaymentPlan>,
  context: IdssBillingContext,
  month: BillingMonth,
  issueDate: string,
): { drafts: Array<InvoiceDraft & { planItems: PlanItemRef[] }>; problems: string[] } {
  const { from, to } = monthBounds(month);
  const schoolYear = schoolYearOfMonth(month);
  const calendarMonth = Number(month.slice(5, 7));
  const buyer = detail.guardians.find((g) => g.isPayer);
  const children = new Map(detail.children.map((c) => [c.id, c]));
  const enrolled = detail.enrolments.filter(
    (e) =>
      e.schoolYear === schoolYear &&
      PROGRAM_ENTITY[e.program] === 'IDSS' &&
      ACTIVE_STATUSES.has(e.status) &&
      e.startsOn <= to &&
      (e.endsOn === null || e.endsOn >= from),
  );
  const drafts: Array<InvoiceDraft & { planItems: PlanItemRef[] }> = [];
  const problems: string[] = [];

  for (const enrolment of enrolled) {
    const child = children.get(enrolment.childId);
    if (!child) continue;
    const name = childName(child);
    const own = plans.filter((p) => p.enrolmentId === enrolment.id);
    if (!own.some((p) => p.itemCode === 'TUITION')) {
      problems.push(`${name}: nema plan plaćanja školarine (IDSS)`);
      continue;
    }
    const due = own.flatMap((plan) =>
      plan.items.filter((i) => i.invoiceId === null && i.dueDate >= from && i.dueDate <= to).map((item) => ({ plan, item })),
    );
    const lines: InvoiceLine[] = due.map(({ plan, item }) => ({
      itemCode: plan.itemCode,
      description: `${ITEM_LABEL[plan.itemCode]} — rata ${item.sequence}/${plan.instalments} (${monthLabel(month)}) — ${name} (${PROGRAM_LABEL[enrolment.program]})`,
      childId: child.id,
      enrolmentId: enrolment.id,
      program: enrolment.program,
      listAmount: item.amount,
      boardDecisionId: null,
      amount: item.amount,
    }));

    if (context.breakfast.has(enrolment.id)) {
      if (!context.rules || context.rules.breakfastMonths.length === 0) {
        problems.push(`${name}: doručak — Školski odbor još nije utvrdio mjesece naplate (Postavke → Pravila naplate)`);
      } else if (context.rules.breakfastMonths.includes(calendarMonth)) {
        const price = findPrice(context.priceItems, { schoolYear, program: enrolment.program, item: 'BREAKFAST', residency: child.residency, tier: 'ANY' });
        if (price.basis !== 'MONTHLY') throw new InvoiceError('doručak mora biti mjesečna cijena');
        lines.push({
          itemCode: 'BREAKFAST',
          description: `${ITEM_LABEL.BREAKFAST} — ${monthLabel(month)} — ${name} (${PROGRAM_LABEL[enrolment.program]})`,
          childId: child.id,
          enrolmentId: enrolment.id,
          program: enrolment.program,
          listAmount: price.amount,
          boardDecisionId: null,
          amount: price.amount,
        });
      }
    }

    if (lines.length === 0) continue;
    if (!buyer) {
      problems.push(`porodica „${detail.family.displayName}“ nema kupca na računu`);
      break;
    }
    drafts.push({
      entity: 'IDSS',
      familyId: detail.family.id,
      childId: child.id,
      childName: name,
      buyerName: buyer.fullName,
      buyerAddress: detail.family.address,
      issueDate,
      dueDate: dueDateForMonth(month, issueDate),
      periodFrom: from,
      periodTo: to,
      lines,
      total: sum(lines.map((l) => l.amount)),
      planItems: due.map(({ plan, item }) => ({ planId: plan.id, sequence: item.sequence })),
    });
  }
  return { drafts, problems };
}
