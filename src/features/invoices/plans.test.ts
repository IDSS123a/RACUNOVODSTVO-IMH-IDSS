import { describe, expect, it } from 'vitest';
import { sum } from '@/features/billing/money';
import type { FamilyDetail } from '@/features/families/types';
import { PRICE_LIST_SEED } from '@/features/price-lists/seed';
import { InvoiceError } from './domain';
import { buildIdssMonthlyInvoices, proposeIdssPlan, type PaymentPlan } from './plans';

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

describe('IDSS payment plan proposal', () => {
  it('first child 9.700 in 12 instalments; younger sibling −10 % = 8.730', () => {
    const first = proposeIdssPlan(family(), PRICE_LIST_SEED, id(20), 'TUITION', 12);
    expect(first.total).toBe(970000);
    expect(first.items[0]?.dueDate).toBe('2026-09-05');
    expect(first.items[11]?.amount).toBe(80837);
    const second = proposeIdssPlan(family(), PRICE_LIST_SEED, id(21), 'TUITION', 10);
    expect(second.total).toBe(873000);
    expect(sum(second.items.map((i) => i.amount))).toBe(873000);
  });

  it('January start: pro-rata 6/10 of the annual tuition, at most 8 instalments to 31.08.', () => {
    const late = family({ enrolments: [{ id: id(20), childId: id(10), program: 'PRIMARY_1_4', schoolYear: '2026/2027', startsOn: '2027-01-11', endsOn: null, status: 'ACTIVE' }] });
    const proposal = proposeIdssPlan(late, PRICE_LIST_SEED, id(20), 'TUITION', 6);
    expect(proposal.total).toBe(582000);
    expect(proposal.items[0]?.dueDate).toBe('2027-01-05');
    expect(() => proposeIdssPlan(late, PRICE_LIST_SEED, id(20), 'TUITION', 9)).toThrow(/najviše je 8 rata/);
  });

  it('extended stay: no sibling discount, at most 10 instalments; kindergarten enrolments have no plan', () => {
    const stay = proposeIdssPlan(family(), PRICE_LIST_SEED, id(21), 'EXTENDED_STAY', 10);
    expect(stay.total).toBe(250000);
    expect(() => proposeIdssPlan(family(), PRICE_LIST_SEED, id(21), 'EXTENDED_STAY', 11)).toThrow(InvoiceError);
    expect(() => proposeIdssPlan(family(), PRICE_LIST_SEED, id(22), 'TUITION', 10)).toThrow(InvoiceError);
  });
});

describe('IDSS monthly invoices from plans', () => {
  it('one invoice per child with the instalments due in the month; already invoiced instalments are skipped', () => {
    const detail = family();
    const tuition = plan(id(30), id(20), id(10), proposeIdssPlan(detail, PRICE_LIST_SEED, id(20), 'TUITION', 10));
    const stay = plan(id(31), id(20), id(10), proposeIdssPlan(detail, PRICE_LIST_SEED, id(20), 'EXTENDED_STAY', 10), 'EXTENDED_STAY');
    const sibling = plan(id(32), id(21), id(11), proposeIdssPlan(detail, PRICE_LIST_SEED, id(21), 'TUITION', 1));
    const { drafts, problems } = buildIdssMonthlyInvoices(detail, [tuition, stay, sibling], '2026-10', '2026-10-01');
    expect(problems).toEqual([]);
    expect(drafts).toHaveLength(1); // the sibling paid everything in September
    expect(drafts[0]?.entity).toBe('IDSS');
    expect(drafts[0]?.lines.map((l) => l.amount)).toEqual([97000, 25000]);
    expect(drafts[0]?.planItems).toEqual([{ planId: id(30), sequence: 2 }, { planId: id(31), sequence: 2 }]);
    expect(drafts[0]?.dueDate).toBe('2026-10-05');

    const billed: PaymentPlan = { ...tuition, items: tuition.items.map((i) => (i.sequence === 2 ? { ...i, invoiceId: 'x' } : i)) };
    const again = buildIdssMonthlyInvoices(detail, [billed, sibling], '2026-10', '2026-10-01');
    expect(again.drafts).toEqual([]);
  });

  it('a school child without a tuition plan is reported, not skipped silently', () => {
    const { drafts, problems } = buildIdssMonthlyInvoices(family(), [], '2026-10', '2026-10-01');
    expect(drafts).toEqual([]);
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain('nema plan plaćanja');
  });
});
