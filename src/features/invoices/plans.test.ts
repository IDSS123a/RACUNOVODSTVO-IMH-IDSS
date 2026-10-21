import { describe, expect, it } from 'vitest';
import { sum } from '@/features/billing/money';
import type { BoardBillingRules } from '@/features/board-rules/types';
import type { FamilyDetail } from '@/features/families/types';
import { PRICE_LIST_SEED } from '@/features/price-lists/seed';
import { InvoiceError } from './domain';
import { buildIdssMonthlyInvoices, proposeIdssPlan, type IdssBillingContext, type PaymentPlan } from './plans';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const FAMILY = id(1);

function family(overrides: Partial<FamilyDetail> = {}): FamilyDetail {
  return {
    family: { id: FAMILY, displayName: 'Test', address: 'Buka 1, Sarajevo' },
    guardians: [{ id: id(2), familyId: FAMILY, fullName: 'Otac Test', role: 'FATHER', email: '', phone: '', iban: '', isPayer: true }],
    children: [
      { id: id(10), familyId: FAMILY, firstName: 'Starija', lastName: 'Test', dateOfBirth: '2016-01-01', residency: 'DOMESTIC', citizenBih: true, residenceKs: true },
      { id: id(11), familyId: FAMILY, firstName: 'Mlađa', lastName: 'Test', dateOfBirth: '2018-01-01', residency: 'DOMESTIC', citizenBih: true, residenceKs: true },
      { id: id(12), familyId: FAMILY, firstName: 'Vrtić', lastName: 'Test', dateOfBirth: '2022-01-01', residency: 'DOMESTIC', citizenBih: true, residenceKs: true },
    ],
    enrolments: [
      { id: id(20), childId: id(10), program: 'PRIMARY_1_4', schoolYear: '2026/2027', startsOn: '2026-09-01', endsOn: null, status: 'ACTIVE' },
      { id: id(21), childId: id(11), program: 'PRIMARY_1_4', schoolYear: '2026/2027', startsOn: '2026-09-01', endsOn: null, status: 'ACTIVE' },
      { id: id(22), childId: id(12), program: 'TODDLERS', schoolYear: '2026/2027', startsOn: '2026-09-01', endsOn: null, status: 'ACTIVE' },
    ],
    ...overrides,
  };
}

function plan(planId: string, enrolmentId: string, childId: string, proposal: ReturnType<typeof proposeIdssPlan>, itemCode: PaymentPlan['itemCode'] = 'TUITION'): PaymentPlan {
  return {
    id: planId, enrolmentId, childId, itemCode, instalments: proposal.items.length, total: proposal.total,
    items: proposal.items.map((i) => ({ ...i, invoiceId: null })),
  };
}

const RULES: BoardBillingRules = {
  schoolYear: '2026/2027', entity: 'IDSS', lastInstalmentBy: null, breakfastMonths: [9, 10, 11, 12, 1, 2, 3, 4, 5, 6], decisionRef: 'ŠO test',
};

function context(overrides: Partial<IdssBillingContext> = {}): IdssBillingContext {
  return { priceItems: PRICE_LIST_SEED, rules: null, breakfast: new Set(), ...overrides };
}

describe('IDSS payment plan proposal', () => {
  it('first child 9.700 in 12 instalments; younger sibling −10 % = 8.730', () => {
    const first = proposeIdssPlan(family(), PRICE_LIST_SEED, id(20), 'TUITION', 12, null);
    expect(first.total).toBe(970000);
    expect(first.items[0]?.dueDate).toBe('2026-09-05');
    expect(first.items[11]?.amount).toBe(80837);
    const second = proposeIdssPlan(family(), PRICE_LIST_SEED, id(21), 'TUITION', 10, null);
    expect(second.total).toBe(873000);
    expect(sum(second.items.map((i) => i.amount))).toBe(873000);
  });

  it('January start: pro-rata 6/10 of the annual tuition', () => {
    const late = family({ enrolments: [{ id: id(20), childId: id(10), program: 'PRIMARY_1_4', schoolYear: '2026/2027', startsOn: '2027-01-11', endsOn: null, status: 'ACTIVE' }] });
    const proposal = proposeIdssPlan(late, PRICE_LIST_SEED, id(20), 'TUITION', 6, null);
    expect(proposal.total).toBe(582000);
    expect(proposal.items[0]?.dueDate).toBe('2027-01-05');
  });

  it('the last-instalment deadline is enforced only when the board decided one', () => {
    expect(proposeIdssPlan(family(), PRICE_LIST_SEED, id(20), 'TUITION', 12, null).items).toHaveLength(12);
    expect(() => proposeIdssPlan(family(), PRICE_LIST_SEED, id(20), 'TUITION', 12, '2027-06-05')).toThrow(/najviše je 10 rata/);
    expect(proposeIdssPlan(family(), PRICE_LIST_SEED, id(20), 'TUITION', 10, '2027-06-05').items).toHaveLength(10);
  });

  it('extended stay: no sibling discount, at most 10 instalments; kindergarten enrolments have no plan', () => {
    const stay = proposeIdssPlan(family(), PRICE_LIST_SEED, id(21), 'EXTENDED_STAY', 10, null);
    expect(stay.total).toBe(250000);
    expect(() => proposeIdssPlan(family(), PRICE_LIST_SEED, id(21), 'EXTENDED_STAY', 11, null)).toThrow(InvoiceError);
    expect(() => proposeIdssPlan(family(), PRICE_LIST_SEED, id(22), 'TUITION', 10, null)).toThrow(InvoiceError);
  });
});

describe('IDSS monthly invoices from plans', () => {
  const detail = family();
  const tuition = plan(id(30), id(20), id(10), proposeIdssPlan(detail, PRICE_LIST_SEED, id(20), 'TUITION', 10, null));
  const stay = plan(id(31), id(20), id(10), proposeIdssPlan(detail, PRICE_LIST_SEED, id(20), 'EXTENDED_STAY', 10, null), 'EXTENDED_STAY');
  const sibling = plan(id(32), id(21), id(11), proposeIdssPlan(detail, PRICE_LIST_SEED, id(21), 'TUITION', 1, null));

  it('one invoice per child with the instalments due in the month; already invoiced instalments are skipped', () => {
    const { drafts, problems } = buildIdssMonthlyInvoices(detail, [tuition, stay, sibling], context(), '2026-10', '2026-10-01');
    expect(problems).toEqual([]);
    expect(drafts).toHaveLength(1); // the sibling paid everything in September
    expect(drafts[0]?.entity).toBe('IDSS');
    expect(drafts[0]?.lines.map((l) => l.amount)).toEqual([97000, 25000]);
    expect(drafts[0]?.planItems).toEqual([{ planId: id(30), sequence: 2 }, { planId: id(31), sequence: 2 }]);
    expect(drafts[0]?.dueDate).toBe('2026-10-05');

    const billed: PaymentPlan = { ...tuition, items: tuition.items.map((i) => (i.sequence === 2 ? { ...i, invoiceId: 'x' } : i)) };
    expect(buildIdssMonthlyInvoices(detail, [billed, sibling], context(), '2026-10', '2026-10-01').drafts).toEqual([]);
  });

  it('breakfast is billed only in the months the board decided, even when no instalment is due', () => {
    const withBreakfast = context({ rules: RULES, breakfast: new Set([id(21)]) });
    const october = buildIdssMonthlyInvoices(detail, [tuition, sibling], withBreakfast, '2026-10', '2026-10-01');
    const siblingInvoice = october.drafts.find((d) => d.childId === id(11));
    expect(siblingInvoice?.lines.map((l) => [l.itemCode, l.amount])).toEqual([['BREAKFAST', 6000]]);
    expect(siblingInvoice?.planItems).toEqual([]);
    const july = buildIdssMonthlyInvoices(detail, [tuition, sibling], withBreakfast, '2027-07', '2027-07-01');
    expect(july.drafts.find((d) => d.childId === id(11))).toBeUndefined();
  });

  it('reports a child without a tuition plan, and breakfast while the board months are not entered', () => {
    const none = buildIdssMonthlyInvoices(detail, [], context(), '2026-10', '2026-10-01');
    expect(none.drafts).toEqual([]);
    expect(none.problems).toHaveLength(2);
    expect(none.problems[0]).toContain('nema plan plaćanja');
    const undecided = buildIdssMonthlyInvoices(detail, [tuition, sibling], context({ breakfast: new Set([id(20)]) }), '2026-10', '2026-10-01');
    expect(undecided.problems).toEqual([expect.stringContaining('Školski odbor još nije utvrdio')]);
    expect(undecided.drafts[0]?.lines.map((l) => l.itemCode)).toEqual(['TUITION']);
  });
});
