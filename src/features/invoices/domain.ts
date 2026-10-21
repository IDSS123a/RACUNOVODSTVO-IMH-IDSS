import { INSTALMENT_DUE_DAY } from '@/constants';
import { divideRounded, sum, type Fenings } from '@/features/billing/money';
import { applyBoardDecision, assignSiblingTiers, findPrice, type BoardDecisionEffect } from '@/features/billing/pricing';
import { ACTIVE_STATUSES, knownBirthDate } from '@/features/families/domain';
import type { Child, Enrolment, FamilyDetail } from '@/features/families/types';
import {
  PROGRAM_ENTITY,
  PROGRAM_LABEL,
  type LegalEntityCode,
  type PriceItemCode,
  type PriceListItem,
  type SchoolYear,
} from '@/features/price-lists/types';
import { MONTH_NAME, type BillingMonth, type InvoiceDraft, type InvoiceLine, type PaymentSummary, type PlanInstalment } from './types';

/**
 * Invoice domain (Sprint 03) — pure functions, unit-tested.
 * Every amount comes from the price list via the pricing engine; nothing is computed in the UI.
 */

export class InvoiceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvoiceError';
  }
}

/** A board decision as it applies to billing (BR-7). */
export interface BoardDecision {
  readonly id: string;
  readonly childId: string;
  readonly item: PriceItemCode;
  readonly validFrom: string;
  readonly validTo: string;
  readonly effect: BoardDecisionEffect;
}

/** First and last calendar day of a month "YYYY-MM". */
export function monthBounds(month: BillingMonth): { from: string; to: string } {
  const [year, mon] = month.split('-').map(Number);
  if (!year || !mon || mon < 1 || mon > 12) throw new InvoiceError(`invalid month ${month}`);
  const last = new Date(Date.UTC(year, mon, 0)).getUTCDate();
  const mm = String(mon).padStart(2, '0');
  return { from: `${year}-${mm}-01`, to: `${year}-${mm}-${String(last).padStart(2, '0')}` };
}

/** School year that contains a month (September starts a new year). */
export function schoolYearOfMonth(month: BillingMonth): SchoolYear {
  const [year, mon] = month.split('-').map(Number);
  if (!year || !mon) throw new InvoiceError(`invalid month ${month}`);
  return mon >= 9 ? `${year}/${year + 1}` : `${year - 1}/${year}`;
}

/** Bosnian month label, e.g. "oktobar 2026". */
export function monthLabel(month: BillingMonth): string {
  const [year, mon] = month.split('-').map(Number);
  return `${MONTH_NAME[(mon ?? 1) - 1]} ${year}`;
}

/** Due date: the 5th of the billing month, or the issue date if that is later (IMH/IDSS Pravilnik). */
export function dueDateForMonth(month: BillingMonth, issueDate: string): string {
  const due = `${month}-${String(INSTALMENT_DUE_DAY).padStart(2, '0')}`;
  return issueDate > due ? issueDate : due;
}

/** True when the enrolment covers at least one day of the month. */
function activeInMonth(enrolment: Enrolment, from: string, to: string): boolean {
  return ACTIVE_STATUSES.has(enrolment.status) && enrolment.startsOn <= to && (enrolment.endsOn === null || enrolment.endsOn >= from);
}

/** The board decision valid for this child, item and date, if any. Two overlapping decisions are an error. */
export function decisionFor(decisions: ReadonlyArray<BoardDecision>, childId: string, item: PriceItemCode, date: string): BoardDecision | null {
  const matching = decisions.filter((d) => d.childId === childId && d.item === item && d.validFrom <= date && d.validTo >= date);
  if (matching.length > 1) throw new InvoiceError('za isto dijete i stavku važi više odluka odbora istovremeno');
  return matching[0] ?? null;
}

function payer(detail: FamilyDetail): { name: string } {
  const buyer = detail.guardians.find((g) => g.isPayer);
  if (!buyer) throw new InvoiceError(`porodica „${detail.family.displayName}“ nema kupca na računu`);
  return { name: buyer.fullName };
}

function childName(child: Child): string {
  return `${child.firstName} ${child.lastName}`;
}

/**
 * IMH monthly invoices for one family — **one invoice per child** (BR-27).
 * Tier by date of birth within IMH (BR-6), price from the price list, board decision applied if valid.
 * @returns an empty list when no child of the family attends IMH that month
 */
export function buildImhMonthlyInvoices(
  detail: FamilyDetail,
  priceItems: ReadonlyArray<PriceListItem>,
  decisions: ReadonlyArray<BoardDecision>,
  month: BillingMonth,
  issueDate: string,
): InvoiceDraft[] {
  const { from, to } = monthBounds(month);
  const schoolYear = schoolYearOfMonth(month);
  const children = new Map(detail.children.map((c) => [c.id, c]));
  const enrolled = detail.enrolments.filter(
    (e) => e.schoolYear === schoolYear && PROGRAM_ENTITY[e.program] === 'IMH' && activeInMonth(e, from, to) && children.has(e.childId),
  );
  if (enrolled.length === 0) return [];

  const buyer = payer(detail);
  const tiers = assignSiblingTiers(
    enrolled.map((e) => {
      const child = children.get(e.childId);
      if (!child) throw new InvoiceError('unreachable: child missing');
      return { childId: e.childId, dateOfBirth: knownBirthDate(child), program: e.program };
    }),
  );
  return enrolled
    .map((enrolment) => {
      const child = children.get(enrolment.childId);
      if (!child) throw new InvoiceError('unreachable: child missing');
      const tier = tiers.get(child.id) ?? 'FIRST';
      const price = findPrice(priceItems, { schoolYear, program: enrolment.program, item: 'TUITION', residency: child.residency, tier });
      if (price.basis !== 'MONTHLY') throw new InvoiceError('IMH školarina mora biti mjesečna');
      const decision = decisionFor(decisions, child.id, 'TUITION', from);
      const line: InvoiceLine = {
        itemCode: 'TUITION',
        description: `Školarina za ${monthLabel(month)} — ${childName(child)} (${PROGRAM_LABEL[enrolment.program]})`,
        childId: child.id,
        enrolmentId: enrolment.id,
        program: enrolment.program,
        listAmount: price.amount,
        boardDecisionId: decision?.id ?? null,
        amount: decision ? applyBoardDecision(price.amount, decision.effect) : price.amount,
      };
      const draft: InvoiceDraft = {
        entity: 'IMH',
        familyId: detail.family.id,
        childId: child.id,
        childName: childName(child),
        buyerName: buyer.name,
        buyerAddress: detail.family.address,
        issueDate,
        dueDate: dueDateForMonth(month, issueDate),
        periodFrom: from,
        periodTo: to,
        lines: [line],
        total: sum([line.amount]),
      };
      return { draft, dateOfBirth: knownBirthDate(child) };
    })
    .sort((a, b) => a.dateOfBirth.localeCompare(b.dateOfBirth))
    .map((entry) => entry.draft);
}

/**
 * Split an amount into N instalments due on the 5th of consecutive months (BR-11).
 * Every instalment is rounded once; the last one absorbs the difference, so the sum is exact.
 * @param total amount to split (fenings)
 * @param count number of instalments, 1–12
 * @param firstMonth month of the first instalment
 */
export function splitIntoInstalments(total: Fenings, count: number, firstMonth: BillingMonth): PlanInstalment[] {
  if (!Number.isInteger(count) || count < 1 || count > 12) throw new InvoiceError('broj rata mora biti od 1 do 12');
  if (total < 0) throw new InvoiceError('iznos ne može biti negativan');
  const regular = divideRounded(total, count);
  const [year, mon] = firstMonth.split('-').map(Number);
  if (!year || !mon) throw new InvoiceError(`invalid month ${firstMonth}`);
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(Date.UTC(year, mon - 1 + index, INSTALMENT_DUE_DAY));
    const dueDate = date.toISOString().slice(0, 10);
    const amount = index === count - 1 ? total - regular * (count - 1) : regular;
    return { sequence: index + 1, dueDate, amount };
  });
}

/** Payment status of an invoice from the booked payments (any family member may pay — BR-24). */
export function summarisePayments(total: Fenings, payments: ReadonlyArray<Fenings>): PaymentSummary {
  const paid = sum(payments);
  const open = Math.max(0, total - paid);
  const credit = Math.max(0, paid - total);
  const status = paid === 0 ? 'OPEN' : paid < total ? 'PARTIALLY_PAID' : paid === total ? 'PAID' : 'OVERPAID';
  return { total, paid, open, credit, status };
}

/** Entities in which a family has at least one active enrolment in the school year. */
export function entitiesOfFamily(detail: FamilyDetail, schoolYear: SchoolYear): LegalEntityCode[] {
  const set = new Set(
    detail.enrolments.filter((e) => e.schoolYear === schoolYear && ACTIVE_STATUSES.has(e.status)).map((e) => PROGRAM_ENTITY[e.program]),
  );
  return [...set].sort();
}
