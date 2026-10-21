import { describe, expect, it } from 'vitest';
import type { Enrolment, FamilyDetail } from '@/features/families/types';
import { PRICE_LIST_SEED } from '@/features/price-lists/seed';
import { InvoiceError } from './domain';
import { buildEnrolmentFeeInvoice } from './enrolment-fees';
import type { PaymentPlan } from './plans';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const FAMILY = id(1);

function enrolment(n: number, childId: string, program: Enrolment['program'], schoolYear = '2026/2027', status: Enrolment['status'] = 'AWAITING_ENROLMENT_PAYMENT'): Enrolment {
  return { id: id(n), childId, program, schoolYear, startsOn: `${schoolYear.slice(0, 4)}-09-01`, endsOn: null, status };
}

function family(enrolments: Enrolment[]): FamilyDetail {
  return {
    family: { id: FAMILY, displayName: 'Test', address: 'Buka 1' },
    guardians: [{ id: id(2), familyId: FAMILY, fullName: 'Majka Test', role: 'MOTHER', email: '', phone: '', iban: '', isPayer: true }],
    children: [
      { id: id(10), familyId: FAMILY, firstName: 'Starija', lastName: 'Test', dateOfBirth: '2021-01-01', residency: 'DOMESTIC', citizenBih: true, residenceKs: true },
      { id: id(11), familyId: FAMILY, firstName: 'Mlađa', lastName: 'Test', dateOfBirth: '2023-01-01', residency: 'DOMESTIC', citizenBih: true, residenceKs: true },
      { id: id(12), familyId: FAMILY, firstName: 'Školarac', lastName: 'Test', dateOfBirth: '2019-01-01', residency: 'FOREIGN', citizenBih: false, residenceKs: true },
    ],
    enrolments,
  };
}

const NO_DEPOSIT = { idssDeposit: false };
const amounts = (p: ReturnType<typeof buildEnrolmentFeeInvoice>) => p.draft.lines.map((l) => [l.itemCode, l.amount]);

describe('IMH enrolment-fee invoice', () => {
  it('new child: enrolment fee + materials + deposit; younger sibling pays the subsequent deposit', () => {
    const detail = family([enrolment(20, id(10), 'PRESCHOOLERS'), enrolment(21, id(11), 'TODDLERS')]);
    const older = buildEnrolmentFeeInvoice(detail, PRICE_LIST_SEED, [], id(20), NO_DEPOSIT, '2026-08-01');
    expect(amounts(older)).toEqual([['ENROLMENT_FEE', 20000], ['MATERIALS', 30000], ['DEPOSIT', 71000]]);
    expect(older.draft.total).toBe(121000);
    expect(older.draft.dueDate).toBe('2026-08-31'); // before the child starts
    expect(older.draft.periodFrom).toBe('2026-09-01');
    const younger = buildEnrolmentFeeInvoice(detail, PRICE_LIST_SEED, [], id(21), NO_DEPOSIT, '2026-08-01');
    expect(amounts(younger)).toContainEqual(['DEPOSIT', 57000]);
  });

  it('continuing child: no enrolment fee (valid until withdrawal); a withdrawn child pays again', () => {
    const continuing = family([enrolment(19, id(11), 'TODDLERS', '2025/2026', 'COMPLETED'), enrolment(21, id(11), 'PRESCHOOLERS')]);
    const proposal = buildEnrolmentFeeInvoice(continuing, PRICE_LIST_SEED, [], id(21), NO_DEPOSIT, '2026-08-01');
    expect(amounts(proposal).map(([item]) => item)).toEqual(['MATERIALS', 'DEPOSIT']);
    expect(proposal.notes[0]).toContain('važi do ispisa');
    const withdrawn = family([enrolment(19, id(11), 'TODDLERS', '2025/2026', 'WITHDRAWN'), enrolment(21, id(11), 'PRESCHOOLERS')]);
    expect(amounts(buildEnrolmentFeeInvoice(withdrawn, PRICE_LIST_SEED, [], id(21), NO_DEPOSIT, '2026-08-01'))[0]?.[0]).toBe('ENROLMENT_FEE');
  });

  it('transfer Preschoolers → IDSS Preschoolers: only materials (no fee, deposit carried over)', () => {
    const detail = family([enrolment(19, id(10), 'PRESCHOOLERS', '2025/2026', 'COMPLETED'), enrolment(20, id(10), 'IDSS_PRESCHOOLERS')]);
    const proposal = buildEnrolmentFeeInvoice(detail, PRICE_LIST_SEED, [], id(20), NO_DEPOSIT, '2026-08-01');
    expect(amounts(proposal)).toEqual([['MATERIALS', 30000]]);
    expect(proposal.notes[0]).toContain('depozit se prenosi');
  });
});

describe('IDSS enrolment-fee invoice', () => {
  const plan = (instalments: number): PaymentPlan => ({ id: 'p', enrolmentId: id(22), childId: id(12), itemCode: 'TUITION', instalments, total: 1, items: [] });

  it('new pupil (foreign): 1.500, due in 7 days; deposit only with an instalment plan', () => {
    const detail = family([enrolment(22, id(12), 'PRIMARY_1_4')]);
    const proposal = buildEnrolmentFeeInvoice(detail, PRICE_LIST_SEED, [], id(22), NO_DEPOSIT, '2026-06-10');
    expect(amounts(proposal)).toEqual([['ENROLMENT_FEE', 150000]]);
    expect(proposal.draft.entity).toBe('IDSS');
    expect(proposal.draft.dueDate).toBe('2026-06-17');
    expect(() => buildEnrolmentFeeInvoice(detail, PRICE_LIST_SEED, [plan(1)], id(22), { idssDeposit: true }, '2026-06-10')).toThrow(InvoiceError);
    const withDeposit = buildEnrolmentFeeInvoice(detail, PRICE_LIST_SEED, [plan(10)], id(22), { idssDeposit: true }, '2026-06-10');
    expect(amounts(withDeposit)).toEqual([['ENROLMENT_FEE', 150000], ['DEPOSIT', 150000]]);
  });

  it('after IDSS Preschoolers the fee is reduced (foreign 1.000)', () => {
    const detail = family([enrolment(19, id(12), 'IDSS_PRESCHOOLERS', '2025/2026', 'COMPLETED'), enrolment(22, id(12), 'PRIMARY_1_4')]);
    const proposal = buildEnrolmentFeeInvoice(detail, PRICE_LIST_SEED, [], id(22), NO_DEPOSIT, '2026-06-10');
    expect(amounts(proposal)).toEqual([['ENROLMENT_FEE_AFTER_IDSS_PRESCHOOL', 100000]]);
  });

  it('refuses withdrawn enrolments and invoices with nothing to charge', () => {
    const withdrawn = family([enrolment(22, id(12), 'PRIMARY_1_4', '2026/2027', 'WITHDRAWN')]);
    expect(() => buildEnrolmentFeeInvoice(withdrawn, PRICE_LIST_SEED, [], id(22), NO_DEPOSIT, '2026-06-10')).toThrow(InvoiceError);
    const continuing = family([enrolment(19, id(12), 'PRIMARY_1_4', '2025/2026', 'COMPLETED'), enrolment(22, id(12), 'PRIMARY_1_4')]);
    expect(() => buildEnrolmentFeeInvoice(continuing, PRICE_LIST_SEED, [], id(22), NO_DEPOSIT, '2026-06-10')).toThrow(/nema upisnih troškova/);
  });
});
