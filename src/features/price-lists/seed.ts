import { kmToFenings } from '@/features/billing/money';
import type {
  BillingBasis,
  PriceItemCode,
  PriceListItem,
  ProgramCode,
  SchoolYear,
  SiblingTier,
} from './types';

/**
 * Official price lists, transcribed from the source documents (DL-P005).
 *
 * This module is the ONLY place where prices are written down. On first run the
 * app seeds the database from it; afterwards the database is authoritative
 * and the operator maintains new school years in Settings.
 *
 * Sources:
 * - IMH_PRAVILNIK_2025: IMH Pravilnik o formiranju cijena 2025/2026 (čl. 1, 2)
 * - IMH_PRAVILNIK_2026: IMH Pravilnik o formiranju cijena 2026/2027 (čl. 1, 2) + IMH Cjenovnik 2026/2027
 * - IDSS_CJENOVNIK_2025: IDSS Cjenovnik školovanja 2025/2026
 * - IDSS_PRAVILNIK_2026: IDSS Pravilnik o formiranju cijena 2026/2027 (čl. 1, 2, 9, 11) + IDSS Cjenovnik 2026/2027
 */

const IMH_PRAVILNIK_2025 = 'IMH Pravilnik o formiranju cijena 2025/2026';
const IMH_PRAVILNIK_2026 = 'IMH Pravilnik o formiranju cijena 2026/2027 + Cjenovnik 2026/2027';
const IDSS_CJENOVNIK_2025 = 'IDSS Cjenovnik školovanja 2025/2026';
const IDSS_PRAVILNIK_2026 = 'IDSS Pravilnik o formiranju cijena 2026/2027 + Cjenovnik 2026/2027';

/** [domestic KM, foreign KM] */
type Pair = readonly [number, number];

function pair(
  schoolYear: SchoolYear,
  program: ProgramCode,
  item: PriceItemCode,
  tier: SiblingTier,
  basis: BillingBasis,
  [domestic, foreign]: Pair,
  source: string,
): PriceListItem[] {
  return [
    { schoolYear, program, item, residency: 'DOMESTIC', tier, basis, amount: kmToFenings(domestic), source },
    { schoolYear, program, item, residency: 'FOREIGN', tier, basis, amount: kmToFenings(foreign), source },
  ];
}

/** IMH programs share one price block for Toddlers and Preschoolers (Pravilnik čl. 1, 2). */
function imhBlock(
  schoolYear: SchoolYear,
  program: ProgramCode,
  prices: {
    enrolment: Pair;
    materials: Pair;
    depositFirst: Pair;
    depositSubsequent: Pair;
    tuitionFirst: Pair;
    tuitionSubsequent: Pair;
  },
  source: string,
): PriceListItem[] {
  return [
    ...pair(schoolYear, program, 'ENROLMENT_FEE', 'ANY', 'ONE_TIME', prices.enrolment, source),
    ...pair(schoolYear, program, 'MATERIALS', 'ANY', 'ONE_TIME', prices.materials, source),
    ...pair(schoolYear, program, 'DEPOSIT', 'FIRST', 'ONE_TIME', prices.depositFirst, source),
    ...pair(schoolYear, program, 'DEPOSIT', 'SUBSEQUENT', 'ONE_TIME', prices.depositSubsequent, source),
    ...pair(schoolYear, program, 'TUITION', 'FIRST', 'MONTHLY', prices.tuitionFirst, source),
    ...pair(schoolYear, program, 'TUITION', 'SUBSEQUENT', 'MONTHLY', prices.tuitionSubsequent, source),
  ];
}

/** IDSS primary school tuition rows for one grade band (Cjenovnik). */
function idssTuition(
  schoolYear: SchoolYear,
  program: ProgramCode,
  prices: { first: Pair; second: Pair; thirdPlus: Pair },
  source: string,
): PriceListItem[] {
  return [
    ...pair(schoolYear, program, 'TUITION', 'FIRST', 'ANNUAL', prices.first, source),
    ...pair(schoolYear, program, 'TUITION', 'SECOND', 'ANNUAL', prices.second, source),
    ...pair(schoolYear, program, 'TUITION', 'THIRD_PLUS', 'ANNUAL', prices.thirdPlus, source),
  ];
}

/** IDSS items charged per child regardless of grade band. */
function idssCommon(
  schoolYear: SchoolYear,
  program: ProgramCode,
  prices: { enrolment: Pair; deposit: Pair; extendedStay: Pair },
  source: string,
): PriceListItem[] {
  return [
    ...pair(schoolYear, program, 'ENROLMENT_FEE', 'ANY', 'ONE_TIME', prices.enrolment, source),
    // Deposit only for instalment plans, on the school's decision (Pravilnik čl. 7).
    ...pair(schoolYear, program, 'DEPOSIT', 'ANY', 'ONE_TIME', prices.deposit, source),
    // Extended stay has no sibling discount (Pravilnik čl. 11).
    ...pair(schoolYear, program, 'EXTENDED_STAY', 'ANY', 'ANNUAL', prices.extendedStay, source),
  ];
}

const IMH_2025_TODDLER_PRESCHOOL = {
  enrolment: [50, 60],
  materials: [60, 60],
  depositFirst: [680, 780],
  depositSubsequent: [560, 640],
  tuitionFirst: [680, 780],
  tuitionSubsequent: [560, 640],
} as const;

const IMH_2025_IDSS_PRESCHOOL = {
  enrolment: [500, 1000],
  materials: [60, 60],
  depositFirst: [730, 830],
  depositSubsequent: [580, 670],
  tuitionFirst: [730, 830],
  tuitionSubsequent: [580, 670],
} as const;

const IMH_2026_TODDLER_PRESCHOOL = {
  enrolment: [200, 200],
  materials: [300, 300],
  depositFirst: [710, 810],
  depositSubsequent: [570, 650],
  tuitionFirst: [710, 810],
  tuitionSubsequent: [570, 650],
} as const;

const IMH_2026_IDSS_PRESCHOOL = {
  enrolment: [500, 1000],
  materials: [300, 300],
  depositFirst: [750, 850],
  depositSubsequent: [600, 680],
  tuitionFirst: [750, 850],
  tuitionSubsequent: [600, 680],
} as const;

const IDSS_TUITION_1_4 = { first: [9700, 11970], second: [8730, 10773], thirdPlus: [8245, 10175] } as const;
const IDSS_TUITION_5_9 = { first: [11030, 13700], second: [9927, 12330], thirdPlus: [9376, 11645] } as const;

function seed2025(): PriceListItem[] {
  const year: SchoolYear = '2025/2026';
  const common = { enrolment: [1000, 1500], deposit: [1500, 1500], extendedStay: [2000, 2000] } as const;
  return [
    ...imhBlock(year, 'TODDLERS', IMH_2025_TODDLER_PRESCHOOL, IMH_PRAVILNIK_2025),
    ...imhBlock(year, 'PRESCHOOLERS', IMH_2025_TODDLER_PRESCHOOL, IMH_PRAVILNIK_2025),
    ...imhBlock(year, 'IDSS_PRESCHOOLERS', IMH_2025_IDSS_PRESCHOOL, IMH_PRAVILNIK_2025),
    ...idssCommon(year, 'PRIMARY_1_4', common, IDSS_CJENOVNIK_2025),
    ...idssCommon(year, 'PRIMARY_5_9', common, IDSS_CJENOVNIK_2025),
    ...idssTuition(year, 'PRIMARY_1_4', IDSS_TUITION_1_4, IDSS_CJENOVNIK_2025),
    ...idssTuition(year, 'PRIMARY_5_9', IDSS_TUITION_5_9, IDSS_CJENOVNIK_2025),
  ];
}

function seed2026(): PriceListItem[] {
  const year: SchoolYear = '2026/2027';
  const common = { enrolment: [1000, 1500], deposit: [1500, 1500], extendedStay: [2500, 2500] } as const;
  const afterPreschool: Pair = [500, 1000]; // IDSS Pravilnik čl. 1
  const breakfast: Pair = [60, 60]; // IDSS Pravilnik čl. 9 (one price for all)
  return [
    ...imhBlock(year, 'TODDLERS', IMH_2026_TODDLER_PRESCHOOL, IMH_PRAVILNIK_2026),
    ...imhBlock(year, 'PRESCHOOLERS', IMH_2026_TODDLER_PRESCHOOL, IMH_PRAVILNIK_2026),
    ...imhBlock(year, 'IDSS_PRESCHOOLERS', IMH_2026_IDSS_PRESCHOOL, IMH_PRAVILNIK_2026),
    ...(['PRIMARY_1_4', 'PRIMARY_5_9'] as const).flatMap((program) => [
      ...idssCommon(year, program, common, IDSS_PRAVILNIK_2026),
      ...pair(year, program, 'ENROLMENT_FEE_AFTER_IDSS_PRESCHOOL', 'ANY', 'ONE_TIME', afterPreschool, IDSS_PRAVILNIK_2026),
      ...pair(year, program, 'BREAKFAST', 'ANY', 'MONTHLY', breakfast, IDSS_PRAVILNIK_2026),
    ]),
    ...idssTuition(year, 'PRIMARY_1_4', IDSS_TUITION_1_4, IDSS_PRAVILNIK_2026),
    ...idssTuition(year, 'PRIMARY_5_9', IDSS_TUITION_5_9, IDSS_PRAVILNIK_2026),
  ];
}

/** All seeded price-list rows (2025/26 and 2026/27). */
export const PRICE_LIST_SEED: ReadonlyArray<PriceListItem> = [...seed2025(), ...seed2026()];

/** School years present in the seed, newest first. */
export const SEEDED_SCHOOL_YEARS: ReadonlyArray<SchoolYear> = ['2026/2027', '2025/2026'];
