import { sum } from '@/features/billing/money';
import { assignSiblingTiers, findPrice } from '@/features/billing/pricing';
import { ACTIVE_STATUSES, schoolYearBounds } from '@/features/families/domain';
import type { Enrolment, EnrolmentStatus, FamilyDetail } from '@/features/families/types';
import { previousSchoolYear } from '@/features/price-lists/domain';
import { ITEM_LABEL, PROGRAM_ENTITY, PROGRAM_LABEL, type PriceItemCode, type PriceListItem, type SchoolYear } from '@/features/price-lists/types';
import { InvoiceError } from './domain';
import type { PaymentPlan } from './plans';
import type { InvoiceDraft, InvoiceLine } from './types';

/**
 * Enrolment-fee invoice (CONSTITUTION BR-9, BR-10): one invoice per child and school year with the
 * one-time items as separate lines. Pure function, unit-tested; amounts come only from the price list.
 *
 * IMH (Pravilnik o cijenama čl. 1, docs/business-rules §2.3):
 * - enrolment fee: valid until withdrawal → not charged when the child attended IMH in the previous
 *   school year without withdrawing, nor on the direct transfer Preschoolers → IDSS Preschoolers;
 * - materials participation: once per school year;
 * - deposit: by sibling tier within IMH for a new child; carried over for a child continuing in IMH,
 *   including the transfer Preschoolers → IDSS Preschoolers (Director, 2026-10-21);
 * IDSS (Pravilnik čl. 1, 7; §3.5):
 * - enrolment fee, reduced when the child attended IDSS Preschoolers (IMH) in the previous school year;
 *   not charged again for a pupil continuing at IDSS from the previous school year (Director, 2026-10-21);
 * - deposit: only on the school's decision and only with an instalment plan (operator ticks it).
 */

/** Statuses that mean the child really attended (not withdrawn, not merely awaiting payment). */
const ATTENDED: ReadonlySet<EnrolmentStatus> = new Set(['ACTIVE', 'SUSPENDED', 'COMPLETED']);

/** Due-date rule: IDSS within 7 days (BR-10); IMH before the child starts (BR-9). */
const IDSS_ENROLMENT_FEE_DAYS = 7;

export interface EnrolmentFeeOptions {
  /** IDSS only: deposit requested by the school with an instalment plan. */
  readonly idssDeposit: boolean;
}

export interface EnrolmentFeeProposal {
  readonly draft: InvoiceDraft;
  /** Why an item is not charged — shown to the operator in the preview. */
  readonly notes: ReadonlyArray<string>;
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function buildEnrolmentFeeInvoice(
  detail: FamilyDetail,
  priceItems: ReadonlyArray<PriceListItem>,
  plans: ReadonlyArray<PaymentPlan>,
  enrolmentId: string,
  options: EnrolmentFeeOptions,
  issueDate: string,
): EnrolmentFeeProposal {
  const enrolment = detail.enrolments.find((e) => e.id === enrolmentId);
  if (!enrolment) throw new InvoiceError('upis nije pronađen');
  if (!ACTIVE_STATUSES.has(enrolment.status)) throw new InvoiceError('račun za upis se izdaje samo za aktivan upis ili upis koji čeka uplatu');
  const child = detail.children.find((c) => c.id === enrolment.childId);
  if (!child) throw new InvoiceError('dijete nije pronađeno');
  const buyer = detail.guardians.find((g) => g.isPayer);
  if (!buyer) throw new InvoiceError(`porodica „${detail.family.displayName}“ nema kupca na računu`);

  const entity = PROGRAM_ENTITY[enrolment.program];
  const schoolYear = enrolment.schoolYear as SchoolYear;
  const previous = previousSchoolYear(schoolYear);
  const attendedLastYear = (match: (e: Enrolment) => boolean) =>
    detail.enrolments.some((e) => e.childId === child.id && e.schoolYear === previous && ATTENDED.has(e.status) && match(e));
  const childName = `${child.firstName} ${child.lastName}`;
  const notes: string[] = [];
  const lines: InvoiceLine[] = [];

  const price = (item: PriceItemCode, tier: Parameters<typeof findPrice>[1]['tier'] = 'ANY') => {
    const row = findPrice(priceItems, { schoolYear, program: enrolment.program, item, residency: child.residency, tier });
    if (row.basis !== 'ONE_TIME') throw new InvoiceError(`${ITEM_LABEL[item]} mora biti jednokratna stavka`);
    return row.amount;
  };
  const add = (item: PriceItemCode, amount: number) =>
    lines.push({
      itemCode: item,
      description: `${ITEM_LABEL[item]} ${schoolYear} — ${childName} (${PROGRAM_LABEL[enrolment.program]})`,
      childId: child.id,
      enrolmentId: enrolment.id,
      program: enrolment.program,
      listAmount: amount,
      boardDecisionId: null,
      amount,
    });

  if (entity === 'IMH') {
    const transfer = enrolment.program === 'IDSS_PRESCHOOLERS' && attendedLastYear((e) => e.program === 'PRESCHOOLERS');
    const continuing = attendedLastYear((e) => PROGRAM_ENTITY[e.program] === 'IMH');
    if (transfer) notes.push('Upisnina se ne naplaćuje i depozit se prenosi: direktan prelazak iz Preschoolers u IDSS Preschoolers.');
    else if (continuing) notes.push('Upisnina se ne naplaćuje (važi do ispisa) i depozit se prenosi: dijete je pohađalo IMH prošle godine.');
    // `continuing` includes the transfer: Preschoolers is an IMH program.
    if (!continuing) add('ENROLMENT_FEE', price('ENROLMENT_FEE'));
    add('MATERIALS', price('MATERIALS'));
    if (!continuing) {
      const imhSiblings = detail.enrolments.filter((e) => e.schoolYear === schoolYear && PROGRAM_ENTITY[e.program] === 'IMH' && ACTIVE_STATUSES.has(e.status));
      const births = new Map(detail.children.map((c) => [c.id, c.dateOfBirth]));
      const tiers = assignSiblingTiers(imhSiblings.map((e) => ({ childId: e.childId, dateOfBirth: births.get(e.childId) ?? '', program: e.program })));
      add('DEPOSIT', price('DEPOSIT', tiers.get(child.id) ?? 'FIRST'));
    }
  } else {
    const continuing = attendedLastYear((e) => PROGRAM_ENTITY[e.program] === 'IDSS');
    if (continuing) notes.push('Upisnina se ne naplaćuje: učenik nastavlja školovanje u IDSS.');
    else if (attendedLastYear((e) => e.program === 'IDSS_PRESCHOOLERS')) {
      notes.push('Umanjena upisnina: dijete je prošle godine pohađalo IDSS Preschoolers.');
      add('ENROLMENT_FEE_AFTER_IDSS_PRESCHOOL', price('ENROLMENT_FEE_AFTER_IDSS_PRESCHOOL'));
    } else add('ENROLMENT_FEE', price('ENROLMENT_FEE'));
    if (options.idssDeposit) {
      const tuitionPlan = plans.find((p) => p.enrolmentId === enrolment.id && p.itemCode === 'TUITION');
      if (!tuitionPlan || tuitionPlan.instalments < 2) {
        throw new InvoiceError('depozit IDSS ide samo uz plaćanje školarine na rate — prvo napravite plan plaćanja s više rata');
      }
      add('DEPOSIT', price('DEPOSIT'));
    }
  }

  if (lines.length === 0) throw new InvoiceError('za ovaj upis nema upisnih troškova za naplatu');
  const { from, to } = schoolYearBounds(schoolYear);
  const dayBeforeStart = addDays(enrolment.startsOn, -1);
  const due = entity === 'IDSS' ? addDays(issueDate, IDSS_ENROLMENT_FEE_DAYS) : dayBeforeStart > issueDate ? dayBeforeStart : issueDate;
  return {
    notes,
    draft: {
      entity,
      familyId: detail.family.id,
      childId: child.id,
      childName,
      buyerName: buyer.fullName,
      buyerAddress: detail.family.address,
      issueDate,
      dueDate: due,
      periodFrom: from,
      periodTo: to,
      lines,
      total: sum(lines.map((l) => l.amount)),
    },
  };
}
