import { describe, expect, it } from 'vitest';
import { sum } from '@/features/billing/money';
import type { FamilyDetail } from '@/features/families/types';
import { PRICE_LIST_SEED } from '@/features/price-lists/seed';
import {
  buildImhMonthlyInvoice,
  decisionFor,
  dueDateForMonth,
  InvoiceError,
  monthBounds,
  schoolYearOfMonth,
  splitIntoInstalments,
  summarisePayments,
  type BoardDecision,
} from './domain';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const FAMILY = id(1);

function family(overrides: Partial<FamilyDetail> = {}): FamilyDetail {
  return {
    family: { id: FAMILY, displayName: 'Test', address: 'Buka 1, Sarajevo' },
    guardians: [{ id: id(2), familyId: FAMILY, fullName: 'Majka Test', role: 'MOTHER', email: '', phone: '', iban: '', isPayer: true }],
    children: [
      { id: id(10), familyId: FAMILY, firstName: 'Starija', lastName: 'Test', dateOfBirth: '2021-01-01', residency: 'DOMESTIC', citizenBih: true, residenceKs: true },
      { id: id(11), familyId: FAMILY, firstName: 'Mlađa', lastName: 'Test', dateOfBirth: '2023-01-01', residency: 'DOMESTIC', citizenBih: true, residenceKs: true },
      { id: id(12), familyId: FAMILY, firstName: 'Školarac', lastName: 'Test', dateOfBirth: '2015-01-01', residency: 'DOMESTIC', citizenBih: true, residenceKs: true },
    ],
    enrolments: [
      { id: id(20), childId: id(10), program: 'IDSS_PRESCHOOLERS', schoolYear: '2026/2027', startsOn: '2026-09-01', endsOn: null, status: 'ACTIVE' },
      { id: id(21), childId: id(11), program: 'TODDLERS', schoolYear: '2026/2027', startsOn: '2026-09-01', endsOn: null, status: 'ACTIVE' },
      { id: id(22), childId: id(12), program: 'PRIMARY_1_4', schoolYear: '2026/2027', startsOn: '2026-09-01', endsOn: null, status: 'ACTIVE' },
    ],
    ...overrides,
  };
}

describe('calendar helpers', () => {
  it('month bounds, school year and due date', () => {
    expect(monthBounds('2027-02')).toEqual({ from: '2027-02-01', to: '2027-02-28' });
    expect(monthBounds('2028-02').to).toBe('2028-02-29');
    expect(schoolYearOfMonth('2026-10')).toBe('2026/2027');
    expect(schoolYearOfMonth('2027-08')).toBe('2026/2027');
    expect(dueDateForMonth('2026-10', '2026-10-01')).toBe('2026-10-05');
    expect(dueDateForMonth('2026-10', '2026-10-20')).toBe('2026-10-20');
  });
});

describe('IMH monthly invoice (acceptance)', () => {
  it('two IMH children → one invoice 750 + 570, IDSS child excluded, due on the 5th', () => {
    const draft = buildImhMonthlyInvoice(family(), PRICE_LIST_SEED, [], '2026-10', '2026-10-01');
    expect(draft).not.toBeNull();
    expect(draft?.entity).toBe('IMH');
    expect(draft?.lines.map((l) => l.amount)).toEqual([75000, 57000]);
    expect(draft?.total).toBe(132000);
    expect(draft?.dueDate).toBe('2026-10-05');
    expect(draft?.buyerName).toBe('Majka Test');
    expect(draft?.lines[0]?.description).toContain('oktobar 2026');
  });

  it('a child starting mid-month is billed for that month; a withdrawn child is not', () => {
    const base = family();
    const late = family({
      enrolments: base.enrolments.map((e) =>
        e.id === id(21) ? { ...e, startsOn: '2026-10-15' } : e.id === id(20) ? { ...e, status: 'WITHDRAWN' as const, endsOn: '2026-09-30' } : e,
      ),
    });
    const draft = buildImhMonthlyInvoice(late, PRICE_LIST_SEED, [], '2026-10', '2026-10-01');
    expect(draft?.lines).toHaveLength(1);
    expect(draft?.lines[0]?.amount).toBe(71000); // remaining child returns to full price
  });

  it('applies a valid board decision and records it on the line', () => {
    const decision: BoardDecision = {
      id: id(30), childId: id(11), item: 'TUITION', validFrom: '2026-09-01', validTo: '2027-08-31', effect: { kind: 'DISCOUNT', discountBp: 1250 },
    };
    const draft = buildImhMonthlyInvoice(family(), PRICE_LIST_SEED, [decision], '2026-10', '2026-10-01');
    const line = draft?.lines.find((l) => l.childId === id(11));
    expect(line?.listAmount).toBe(57000);
    expect(line?.amount).toBe(49875);
    expect(line?.boardDecisionId).toBe(id(30));
  });

  it('returns null when no child attends IMH; refuses a family without a buyer', () => {
    const schoolOnly = family({ enrolments: family().enrolments.filter((e) => e.program === 'PRIMARY_1_4') });
    expect(buildImhMonthlyInvoice(schoolOnly, PRICE_LIST_SEED, [], '2026-10', '2026-10-01')).toBeNull();
    const noBuyer = family({ guardians: [] });
    expect(() => buildImhMonthlyInvoice(noBuyer, PRICE_LIST_SEED, [], '2026-10', '2026-10-01')).toThrow(InvoiceError);
  });

  it('refuses overlapping board decisions', () => {
    const d = (n: number): BoardDecision => ({
      id: id(n), childId: id(11), item: 'TUITION', validFrom: '2026-09-01', validTo: '2027-08-31', effect: { kind: 'DISCOUNT', discountBp: 100 },
    });
    expect(() => decisionFor([d(1), d(2)], id(11), 'TUITION', '2026-10-01')).toThrow(InvoiceError);
  });
});

describe('IDSS instalments (acceptance)', () => {
  it('9.700 KM in 12 instalments → 11 × 808,33 + 808,37, exact sum, due on the 5th', () => {
    const plan = splitIntoInstalments(970000, 12, '2026-09');
    expect(plan).toHaveLength(12);
    expect(plan.slice(0, 11).every((i) => i.amount === 80833)).toBe(true);
    expect(plan[11]?.amount).toBe(80837);
    expect(sum(plan.map((i) => i.amount))).toBe(970000);
    expect(plan[0]?.dueDate).toBe('2026-09-05');
    expect(plan[11]?.dueDate).toBe('2027-08-05');
  });

  it('January start: 5.820 KM in 6 instalments', () => {
    const plan = splitIntoInstalments(582000, 6, '2027-01');
    expect(plan.map((i) => i.amount)).toEqual([97000, 97000, 97000, 97000, 97000, 97000]);
    expect(plan[5]?.dueDate).toBe('2027-06-05');
  });

  it('one payment in full and invalid counts', () => {
    expect(splitIntoInstalments(1103000, 1, '2026-09')).toEqual([{ sequence: 1, dueDate: '2026-09-05', amount: 1103000 }]);
    expect(() => splitIntoInstalments(1000, 0, '2026-09')).toThrow(InvoiceError);
    expect(() => splitIntoInstalments(1000, 13, '2026-09')).toThrow(InvoiceError);
  });
});

describe('payments (acceptance)', () => {
  it('500 on 710 → partially paid, then +300 → overpaid with 90 credit', () => {
    expect(summarisePayments(71000, [])).toMatchObject({ status: 'OPEN', open: 71000 });
    expect(summarisePayments(71000, [50000])).toMatchObject({ status: 'PARTIALLY_PAID', open: 21000, credit: 0 });
    expect(summarisePayments(71000, [50000, 30000])).toMatchObject({ status: 'OVERPAID', open: 0, credit: 9000 });
    expect(summarisePayments(71000, [71000])).toMatchObject({ status: 'PAID', open: 0, credit: 0 });
  });
});
