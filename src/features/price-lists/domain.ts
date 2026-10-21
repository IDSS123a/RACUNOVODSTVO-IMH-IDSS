import type { Fenings } from '@/features/billing/money';
import { checkPriceCap, type PriceCapResult } from './price-cap';
import {
  PROGRAM_ENTITY,
  type BillingBasis,
  type LegalEntityCode,
  type PriceItemCode,
  type PriceListItem,
  type ProgramCode,
  type SchoolYear,
  type SiblingTier,
} from './types';

/**
 * View-model builders for the price-list screen. Pure functions, unit-tested;
 * components only render their output (no business logic in UI — E-11).
 */

/** One table row: an item/tier combination with both residency prices. */
export interface PriceTableRow {
  readonly key: string;
  readonly program: ProgramCode;
  readonly item: PriceItemCode;
  readonly tier: SiblingTier;
  readonly basis: BillingBasis;
  readonly domestic: Fenings | null;
  readonly foreign: Fenings | null;
  readonly source: string;
}

const ITEM_ORDER: ReadonlyArray<PriceItemCode> = [
  'TUITION',
  'EXTENDED_STAY',
  'BREAKFAST',
  'ENROLMENT_FEE',
  'ENROLMENT_FEE_AFTER_IDSS_PRESCHOOL',
  'MATERIALS',
  'DEPOSIT',
];
const TIER_ORDER: ReadonlyArray<SiblingTier> = ['ANY', 'FIRST', 'SUBSEQUENT', 'SECOND', 'THIRD_PLUS'];
const PROGRAM_ORDER: ReadonlyArray<ProgramCode> = ['TODDLERS', 'PRESCHOOLERS', 'IDSS_PRESCHOOLERS', 'PRIMARY_1_4', 'PRIMARY_5_9'];

/**
 * Group price rows of one school year and legal entity by program, merging the
 * domestic and foreign prices of the same item/tier into one row.
 */
export function buildPriceTable(
  items: ReadonlyArray<PriceListItem>,
  schoolYear: SchoolYear,
  entity: LegalEntityCode,
): Map<ProgramCode, PriceTableRow[]> {
  const rows = new Map<string, PriceTableRow>();
  for (const item of items) {
    if (item.schoolYear !== schoolYear || PROGRAM_ENTITY[item.program] !== entity) continue;
    const key = `${item.program}|${item.item}|${item.tier}`;
    const existing = rows.get(key);
    const base: PriceTableRow = existing ?? {
      key,
      program: item.program,
      item: item.item,
      tier: item.tier,
      basis: item.basis,
      domestic: null,
      foreign: null,
      source: item.source,
    };
    rows.set(key, item.residency === 'DOMESTIC' ? { ...base, domestic: item.amount } : { ...base, foreign: item.amount });
  }

  const grouped = new Map<ProgramCode, PriceTableRow[]>();
  for (const program of PROGRAM_ORDER) {
    const programRows = [...rows.values()]
      .filter((row) => row.program === program)
      .sort(
        (a, b) =>
          ITEM_ORDER.indexOf(a.item) - ITEM_ORDER.indexOf(b.item) || TIER_ORDER.indexOf(a.tier) - TIER_ORDER.indexOf(b.tier),
      );
    if (programRows.length > 0) grouped.set(program, programRows);
  }
  return grouped;
}

/** The school year immediately before the given one, e.g. 2026/2027 → 2025/2026. */
export function previousSchoolYear(year: SchoolYear): SchoolYear {
  const [start] = year.split('/').map(Number);
  if (start === undefined || Number.isNaN(start)) throw new Error(`invalid school year ${year}`);
  return `${start - 1}/${start}`;
}

/** One line of the price-cap check (IMH monthly tuition, domestic persons). */
export interface PriceCapRow extends PriceCapResult {
  readonly program: ProgramCode;
  readonly tier: SiblingTier;
}

/**
 * Price-cap check for IMH monthly tuition of domestic persons (the Program's beneficiaries).
 * Returns an empty list when the previous year's price list is not available.
 */
export function buildPriceCapRows(
  items: ReadonlyArray<PriceListItem>,
  schoolYear: SchoolYear,
  approvalRecorded: boolean,
): PriceCapRow[] {
  const previousYear = previousSchoolYear(schoolYear);
  const tuition = (year: SchoolYear, program: ProgramCode, tier: SiblingTier) =>
    items.find(
      (row) =>
        row.schoolYear === year &&
        row.program === program &&
        row.item === 'TUITION' &&
        row.residency === 'DOMESTIC' &&
        row.tier === tier,
    );
  const result: PriceCapRow[] = [];
  for (const program of ['TODDLERS', 'PRESCHOOLERS', 'IDSS_PRESCHOOLERS'] as const) {
    for (const tier of ['FIRST', 'SUBSEQUENT'] as const) {
      const previous = tuition(previousYear, program, tier);
      const next = tuition(schoolYear, program, tier);
      if (!previous || !next) continue;
      result.push({ program, tier, ...checkPriceCap(previous.amount, next.amount, approvalRecorded) });
    }
  }
  return result;
}
