import { describe, expect, it } from 'vitest';
import { sum } from './money';
import {
  applyBoardDecision,
  assignSiblingTiers,
  findPrice,
  PricingError,
  remainingTuitionMonths,
  tierForPosition,
  tuitionForYear,
  type SiblingEnrolment,
} from './pricing';
import { PRICE_LIST_SEED } from '@/features/price-lists/seed';
import type { ProgramCode, SchoolYear } from '@/features/price-lists/types';

const YEAR: SchoolYear = '2026/2027';

function monthlyTuition(program: ProgramCode, childId: string, family: SiblingEnrolment[]): number {
  const tier = assignSiblingTiers(family).get(childId);
  if (!tier) throw new Error(`no tier for ${childId}`);
  return findPrice(PRICE_LIST_SEED, { schoolYear: YEAR, program, item: 'TUITION', residency: 'DOMESTIC', tier }).amount;
}

describe('sibling order — discount always on the younger child, per legal entity (BR-6, D11)', () => {
  it('older in Toddlers, younger in IDSS Preschoolers → 710 + 600 = 1.310 KM', () => {
    const family: SiblingEnrolment[] = [
      { childId: 'older', dateOfBirth: '2022-03-01', program: 'TODDLERS' },
      { childId: 'younger', dateOfBirth: '2023-05-10', program: 'IDSS_PRESCHOOLERS' },
    ];
    const total = sum([
      monthlyTuition('TODDLERS', 'older', family),
      monthlyTuition('IDSS_PRESCHOOLERS', 'younger', family),
    ]);
    expect(total).toBe(131000);
  });

  it('order is by date of birth, not by the order of input', () => {
    const tiers = assignSiblingTiers([
      { childId: 'b', dateOfBirth: '2021-01-01', program: 'PRESCHOOLERS' },
      { childId: 'a', dateOfBirth: '2019-01-01', program: 'IDSS_PRESCHOOLERS' },
    ]);
    expect(tiers.get('a')).toBe('FIRST');
    expect(tiers.get('b')).toBe('SUBSEQUENT');
  });

  it('three IMH children → full, subsequent, subsequent — never free (D2)', () => {
    const family: SiblingEnrolment[] = [
      { childId: 'c1', dateOfBirth: '2020-01-01', program: 'IDSS_PRESCHOOLERS' },
      { childId: 'c2', dateOfBirth: '2021-01-01', program: 'PRESCHOOLERS' },
      { childId: 'c3', dateOfBirth: '2023-01-01', program: 'TODDLERS' },
    ];
    const amounts = [
      monthlyTuition('IDSS_PRESCHOOLERS', 'c1', family),
      monthlyTuition('PRESCHOOLERS', 'c2', family),
      monthlyTuition('TODDLERS', 'c3', family),
    ];
    expect(amounts).toEqual([75000, 57000, 57000]);
    expect(amounts.every((amount) => amount > 0)).toBe(true);
  });

  it('IDSS 2nd child −10 %, 3rd and 4th child −15 % (D10)', () => {
    const family: SiblingEnrolment[] = [
      { childId: 'k1', dateOfBirth: '2012-01-01', program: 'PRIMARY_5_9' },
      { childId: 'k2', dateOfBirth: '2014-01-01', program: 'PRIMARY_5_9' },
      { childId: 'k3', dateOfBirth: '2016-01-01', program: 'PRIMARY_1_4' },
      { childId: 'k4', dateOfBirth: '2018-01-01', program: 'PRIMARY_1_4' },
    ];
    const tiers = assignSiblingTiers(family);
    expect([...['k1', 'k2', 'k3', 'k4'].map((id) => tiers.get(id))]).toEqual(['FIRST', 'SECOND', 'THIRD_PLUS', 'THIRD_PLUS']);
    const annual = (program: ProgramCode, id: string) =>
      findPrice(PRICE_LIST_SEED, { schoolYear: YEAR, program, item: 'TUITION', residency: 'DOMESTIC', tier: tiers.get(id) ?? 'FIRST' }).amount;
    expect(annual('PRIMARY_5_9', 'k1')).toBe(1103000);
    expect(annual('PRIMARY_5_9', 'k2')).toBe(992700);
    expect(annual('PRIMARY_1_4', 'k3')).toBe(824500);
    expect(annual('PRIMARY_1_4', 'k4')).toBe(824500);
  });

  it('IMH and IDSS siblings are never counted together (D3)', () => {
    const tiers = assignSiblingTiers([
      { childId: 'school', dateOfBirth: '2016-01-01', program: 'PRIMARY_1_4' },
      { childId: 'kindergarten', dateOfBirth: '2022-01-01', program: 'TODDLERS' },
    ]);
    expect(tiers.get('school')).toBe('FIRST');
    expect(tiers.get('kindergarten')).toBe('FIRST');
  });

  it('when the older sibling leaves, the remaining child returns to the full price', () => {
    const before: SiblingEnrolment[] = [
      { childId: 'older', dateOfBirth: '2020-01-01', program: 'PRESCHOOLERS' },
      { childId: 'younger', dateOfBirth: '2022-01-01', program: 'TODDLERS' },
    ];
    expect(monthlyTuition('TODDLERS', 'younger', before)).toBe(57000);
    const after = before.filter((enrolment) => enrolment.childId !== 'older');
    expect(monthlyTuition('TODDLERS', 'younger', after)).toBe(71000);
  });

  it('rejects a child with two active enrolments in the same entity', () => {
    expect(() =>
      assignSiblingTiers([
        { childId: 'x', dateOfBirth: '2020-01-01', program: 'TODDLERS' },
        { childId: 'x', dateOfBirth: '2020-01-01', program: 'PRESCHOOLERS' },
      ]),
    ).toThrow(PricingError);
  });

  it('maps positions to tiers', () => {
    expect(tierForPosition('IMH', 1)).toBe('FIRST');
    expect(tierForPosition('IMH', 5)).toBe('SUBSEQUENT');
    expect(tierForPosition('IDSS', 2)).toBe('SECOND');
    expect(tierForPosition('IDSS', 4)).toBe('THIRD_PLUS');
    expect(() => tierForPosition('IDSS', 0)).toThrow(PricingError);
  });
});

describe('mid-year start (BR-12)', () => {
  it('counts remaining months including the start month', () => {
    expect(remainingTuitionMonths('IDSS', 9)).toBe(10);
    expect(remainingTuitionMonths('IDSS', 1)).toBe(6);
    expect(remainingTuitionMonths('IDSS', 6)).toBe(1);
    expect(remainingTuitionMonths('IDSS', 7)).toBe(0);
    expect(remainingTuitionMonths('IMH', 9)).toBe(12);
    expect(remainingTuitionMonths('IMH', 1)).toBe(8);
    expect(remainingTuitionMonths('IMH', 8)).toBe(1);
  });

  it('IDSS I–IV January start → 9.700 / 10 × 6 = 5.820 KM', () => {
    const row = findPrice(PRICE_LIST_SEED, {
      schoolYear: YEAR, program: 'PRIMARY_1_4', item: 'TUITION', residency: 'DOMESTIC', tier: 'FIRST',
    });
    expect(tuitionForYear(row, 1)).toBe(582000);
    expect(tuitionForYear(row, 9)).toBe(970000);
  });

  it('IMH Toddlers January start → 710 × 8 = 5.680 KM', () => {
    const row = findPrice(PRICE_LIST_SEED, {
      schoolYear: YEAR, program: 'TODDLERS', item: 'TUITION', residency: 'DOMESTIC', tier: 'FIRST',
    });
    expect(tuitionForYear(row, 1)).toBe(568000);
  });

  it('IDSS foreign 3rd child, V–IX, full year rounds once: 11.645 KM', () => {
    const row = findPrice(PRICE_LIST_SEED, {
      schoolYear: YEAR, program: 'PRIMARY_5_9', item: 'TUITION', residency: 'FOREIGN', tier: 'THIRD_PLUS',
    });
    expect(tuitionForYear(row, 9)).toBe(1164500);
  });
});

describe('price lookup never invents amounts (M-4)', () => {
  it('items without sibling discount match any tier', () => {
    const row = findPrice(PRICE_LIST_SEED, {
      schoolYear: YEAR, program: 'PRIMARY_1_4', item: 'EXTENDED_STAY', residency: 'DOMESTIC', tier: 'THIRD_PLUS',
    });
    expect(row.amount).toBe(250000);
  });

  it('throws when a price does not exist', () => {
    expect(() =>
      findPrice(PRICE_LIST_SEED, {
        schoolYear: '2025/2026', program: 'PRIMARY_1_4', item: 'BREAKFAST', residency: 'DOMESTIC', tier: 'ANY',
      }),
    ).toThrow(PricingError);
  });
});

describe('board decisions (BR-7)', () => {
  it('applies a discount or a fixed amount, never negative', () => {
    expect(applyBoardDecision(71000, { kind: 'DISCOUNT', discountBp: 1250 })).toBe(62125);
    expect(applyBoardDecision(71000, { kind: 'FIXED_AMOUNT', amount: 50000 })).toBe(50000);
    expect(() => applyBoardDecision(71000, { kind: 'FIXED_AMOUNT', amount: -1 })).toThrow(PricingError);
  });
});
