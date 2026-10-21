import { describe, expect, it } from 'vitest';
import { applyDiscount, divideRounded, kmToFenings } from '@/features/billing/money';
import { findPrice } from '@/features/billing/pricing';
import { PRICE_LIST_SEED } from './seed';
import { PriceListItemSchema } from '@/lib/validation/schemas';
import type { ProgramCode, Residency, SchoolYear, SiblingTier } from './types';

/**
 * Independent fixtures transcribed a second time from the documents, so a typo in
 * seed.ts cannot pass silently (acceptance criterion: viewer amounts equal the sources).
 */
const FIXTURES: ReadonlyArray<[SchoolYear, ProgramCode, 'TUITION' | 'DEPOSIT' | 'ENROLMENT_FEE' | 'MATERIALS' | 'EXTENDED_STAY', Residency, SiblingTier, string]> = [
  // IMH Cjenovnik 2026/2027
  ['2026/2027', 'TODDLERS', 'ENROLMENT_FEE', 'DOMESTIC', 'ANY', '200'],
  ['2026/2027', 'PRESCHOOLERS', 'MATERIALS', 'FOREIGN', 'ANY', '300'],
  ['2026/2027', 'TODDLERS', 'DEPOSIT', 'DOMESTIC', 'FIRST', '710'],
  ['2026/2027', 'PRESCHOOLERS', 'DEPOSIT', 'FOREIGN', 'SUBSEQUENT', '650'],
  ['2026/2027', 'TODDLERS', 'TUITION', 'DOMESTIC', 'FIRST', '710'],
  ['2026/2027', 'TODDLERS', 'TUITION', 'DOMESTIC', 'SUBSEQUENT', '570'],
  ['2026/2027', 'PRESCHOOLERS', 'TUITION', 'FOREIGN', 'FIRST', '810'],
  ['2026/2027', 'PRESCHOOLERS', 'TUITION', 'FOREIGN', 'SUBSEQUENT', '650'],
  ['2026/2027', 'IDSS_PRESCHOOLERS', 'ENROLMENT_FEE', 'FOREIGN', 'ANY', '1000'],
  ['2026/2027', 'IDSS_PRESCHOOLERS', 'DEPOSIT', 'DOMESTIC', 'SUBSEQUENT', '600'],
  ['2026/2027', 'IDSS_PRESCHOOLERS', 'TUITION', 'DOMESTIC', 'FIRST', '750'],
  ['2026/2027', 'IDSS_PRESCHOOLERS', 'TUITION', 'FOREIGN', 'SUBSEQUENT', '680'],
  // IDSS Cjenovnik 2026/2027
  ['2026/2027', 'PRIMARY_1_4', 'ENROLMENT_FEE', 'FOREIGN', 'ANY', '1500'],
  ['2026/2027', 'PRIMARY_5_9', 'DEPOSIT', 'DOMESTIC', 'ANY', '1500'],
  ['2026/2027', 'PRIMARY_1_4', 'EXTENDED_STAY', 'DOMESTIC', 'ANY', '2500'],
  ['2026/2027', 'PRIMARY_1_4', 'TUITION', 'FOREIGN', 'SECOND', '10773'],
  ['2026/2027', 'PRIMARY_1_4', 'TUITION', 'FOREIGN', 'THIRD_PLUS', '10175'],
  ['2026/2027', 'PRIMARY_5_9', 'TUITION', 'DOMESTIC', 'THIRD_PLUS', '9376'],
  ['2026/2027', 'PRIMARY_5_9', 'TUITION', 'FOREIGN', 'SECOND', '12330'],
  // IMH Pravilnik 2025/2026
  ['2025/2026', 'TODDLERS', 'ENROLMENT_FEE', 'FOREIGN', 'ANY', '60'],
  ['2025/2026', 'PRESCHOOLERS', 'TUITION', 'DOMESTIC', 'FIRST', '680'],
  ['2025/2026', 'PRESCHOOLERS', 'TUITION', 'DOMESTIC', 'SUBSEQUENT', '560'],
  ['2025/2026', 'IDSS_PRESCHOOLERS', 'TUITION', 'FOREIGN', 'SUBSEQUENT', '670'],
  // IDSS Cjenovnik 2025/2026
  ['2025/2026', 'PRIMARY_1_4', 'EXTENDED_STAY', 'FOREIGN', 'ANY', '2000'],
  ['2025/2026', 'PRIMARY_5_9', 'TUITION', 'FOREIGN', 'FIRST', '13700'],
];

describe('price-list seed', () => {
  it('matches independently transcribed source amounts', () => {
    for (const [schoolYear, program, item, residency, tier, km] of FIXTURES) {
      const row = findPrice(PRICE_LIST_SEED, { schoolYear, program, item, residency, tier });
      expect(row.amount, `${schoolYear} ${program} ${item} ${residency} ${tier}`).toBe(kmToFenings(km));
    }
  });

  it('every row passes the Zod schema and cites a source', () => {
    for (const row of PRICE_LIST_SEED) {
      expect(PriceListItemSchema.safeParse(row).success).toBe(true);
      expect(row.source.length).toBeGreaterThan(10);
    }
  });

  it('has no duplicate rows', () => {
    const keys = PRICE_LIST_SEED.map((row) => [row.schoolYear, row.program, row.item, row.residency, row.tier].join('|'));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('IMH 2026/27: annual amounts in the Cjenovnik equal 12 × monthly', () => {
    const annual: Record<string, number> = {
      'TODDLERS|DOMESTIC|FIRST': 852000, 'TODDLERS|DOMESTIC|SUBSEQUENT': 684000,
      'TODDLERS|FOREIGN|FIRST': 972000, 'TODDLERS|FOREIGN|SUBSEQUENT': 780000,
      'IDSS_PRESCHOOLERS|DOMESTIC|FIRST': 900000, 'IDSS_PRESCHOOLERS|DOMESTIC|SUBSEQUENT': 720000,
      'IDSS_PRESCHOOLERS|FOREIGN|FIRST': 1020000, 'IDSS_PRESCHOOLERS|FOREIGN|SUBSEQUENT': 816000,
    };
    for (const [key, expected] of Object.entries(annual)) {
      const [program, residency, tier] = key.split('|') as [ProgramCode, Residency, SiblingTier];
      const monthly = findPrice(PRICE_LIST_SEED, { schoolYear: '2026/2027', program, item: 'TUITION', residency, tier });
      expect(monthly.amount * 12, key).toBe(expected);
    }
  });

  it('IMH 2026/27: "subsequent" amounts are −20 % rounded to 10 KM (Pravilnik: popust se zaokružuje)', () => {
    for (const program of ['TODDLERS', 'IDSS_PRESCHOOLERS'] as const) {
      for (const residency of ['DOMESTIC', 'FOREIGN'] as const) {
        const first = findPrice(PRICE_LIST_SEED, { schoolYear: '2026/2027', program, item: 'TUITION', residency, tier: 'FIRST' });
        const next = findPrice(PRICE_LIST_SEED, { schoolYear: '2026/2027', program, item: 'TUITION', residency, tier: 'SUBSEQUENT' });
        const roundedTo10Km = divideRounded(applyDiscount(first.amount, 2000), 1000) * 1000;
        expect(next.amount, `${program} ${residency}`).toBe(roundedTo10Km);
      }
    }
  });

  it('IDSS: discounted tuition = −10 % / −15 % rounded to whole KM', () => {
    for (const year of ['2025/2026', '2026/2027'] as const) {
      for (const program of ['PRIMARY_1_4', 'PRIMARY_5_9'] as const) {
        for (const residency of ['DOMESTIC', 'FOREIGN'] as const) {
          const q = { schoolYear: year, program, item: 'TUITION' as const, residency };
          const first = findPrice(PRICE_LIST_SEED, { ...q, tier: 'FIRST' }).amount;
          const second = findPrice(PRICE_LIST_SEED, { ...q, tier: 'SECOND' }).amount;
          const third = findPrice(PRICE_LIST_SEED, { ...q, tier: 'THIRD_PLUS' }).amount;
          expect(second).toBe(divideRounded(applyDiscount(first, 1000), 100) * 100);
          expect(third).toBe(divideRounded(applyDiscount(first, 1500), 100) * 100);
        }
      }
    }
  });
});
