import { IDSS_TUITION_MONTHS, IMH_TUITION_MONTHS, SCHOOL_YEAR_START_MONTH } from '@/constants';
import { applyDiscount, prorate, type BasisPoints, type Fenings } from './money';
import {
  PROGRAM_ENTITY,
  type LegalEntityCode,
  type PriceItemCode,
  type PriceListItem,
  type ProgramCode,
  type Residency,
  type SchoolYear,
  type SiblingTier,
} from '@/features/price-lists/types';

/**
 * Pricing engine — pure domain logic (no Tauri, no React).
 * Implements CONSTITUTION BR-3…BR-8 and BR-12.
 */

/** Thrown when a requested price does not exist. Prices are never invented (M-4). */
export class PricingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PricingError';
  }
}

/** A child's active enrolment, as needed for sibling ordering. */
export interface SiblingEnrolment {
  readonly childId: string;
  /** ISO date "YYYY-MM-DD". */
  readonly dateOfBirth: string;
  readonly program: ProgramCode;
}

/**
 * Order siblings and assign the discount tier, per legal entity (BR-6, D3, D11).
 * The oldest child pays full; younger children get the discount. Children of
 * IMH and IDSS are never counted together. Children who left the institution must
 * not be passed in — the remaining child then automatically returns to FIRST.
 *
 * Tie-break for the same date of birth (e.g. twins): by childId.
 * 📌 ASSUMED: twins have no documented rule; the order is stable and visible to the operator.
 *
 * @param enrolments active enrolments of one family in one school year
 * @returns tier per childId
 */
export function assignSiblingTiers(enrolments: ReadonlyArray<SiblingEnrolment>): Map<string, SiblingTier> {
  const byEntity = new Map<LegalEntityCode, SiblingEnrolment[]>();
  for (const enrolment of enrolments) {
    const entity = PROGRAM_ENTITY[enrolment.program];
    const list = byEntity.get(entity) ?? [];
    if (list.some((existing) => existing.childId === enrolment.childId)) {
      throw new PricingError(`child ${enrolment.childId} has two active enrolments in ${entity}`);
    }
    list.push(enrolment);
    byEntity.set(entity, list);
  }

  const tiers = new Map<string, SiblingTier>();
  for (const [entity, list] of byEntity) {
    const ordered = [...list].sort(
      (a, b) => a.dateOfBirth.localeCompare(b.dateOfBirth) || a.childId.localeCompare(b.childId),
    );
    ordered.forEach((enrolment, index) => {
      tiers.set(enrolment.childId, tierForPosition(entity, index + 1));
    });
  }
  return tiers;
}

/**
 * Map a 1-based position (oldest = 1) to the price-list tier of the entity.
 * IMH: 1 → FIRST, 2+ → SUBSEQUENT (−20 %). IDSS: 1 → FIRST, 2 → SECOND (−10 %), 3+ → THIRD_PLUS (−15 %, D10).
 */
export function tierForPosition(entity: LegalEntityCode, position: number): SiblingTier {
  if (!Number.isInteger(position) || position < 1) throw new PricingError(`invalid sibling position ${position}`);
  if (position === 1) return 'FIRST';
  if (entity === 'IMH') return 'SUBSEQUENT';
  return position === 2 ? 'SECOND' : 'THIRD_PLUS';
}

/** Criteria for one price lookup. */
export interface PriceQuery {
  readonly schoolYear: SchoolYear;
  readonly program: ProgramCode;
  readonly item: PriceItemCode;
  readonly residency: Residency;
  /** Sibling tier; ignored for items whose price-list rows are tier ANY. */
  readonly tier: SiblingTier;
}

/**
 * Find exactly one price-list row. Throws if the row is missing or ambiguous.
 * Items without a sibling discount (tier ANY) match any requested tier.
 */
export function findPrice(items: ReadonlyArray<PriceListItem>, query: PriceQuery): PriceListItem {
  const candidates = items.filter(
    (row) =>
      row.schoolYear === query.schoolYear &&
      row.program === query.program &&
      row.item === query.item &&
      row.residency === query.residency,
  );
  const exact = candidates.filter((row) => row.tier === query.tier);
  const matches = exact.length > 0 ? exact : candidates.filter((row) => row.tier === 'ANY');
  if (matches.length === 0) {
    throw new PricingError(
      `no price for ${query.item} / ${query.program} / ${query.residency} / ${query.tier} in ${query.schoolYear}`,
    );
  }
  if (matches.length > 1) {
    throw new PricingError(`ambiguous price for ${query.item} / ${query.program} in ${query.schoolYear}`);
  }
  const [match] = matches;
  if (!match) throw new PricingError('unreachable: empty match list');
  return match;
}

/**
 * Months still to be charged from a start month until the end of the tuition year (BR-12).
 * IMH: September–August (12). IDSS: September–June (10). The start month counts in full.
 * @param entity legal entity
 * @param startMonth calendar month 1–12 in which attendance starts
 * @returns number of months charged (0 if the start month is outside the tuition year)
 */
export function remainingTuitionMonths(entity: LegalEntityCode, startMonth: number): number {
  if (!Number.isInteger(startMonth) || startMonth < 1 || startMonth > 12) {
    throw new PricingError(`invalid month ${startMonth}`);
  }
  const monthsInYear = entity === 'IMH' ? IMH_TUITION_MONTHS : IDSS_TUITION_MONTHS;
  const offset = (startMonth - SCHOOL_YEAR_START_MONTH + 12) % 12; // September = 0
  return Math.max(0, monthsInYear - offset);
}

/**
 * Tuition owed for the school year from a given start month (BR-12).
 * IMH: monthly price × remaining months. IDSS: annual price × remaining months / 10.
 * Rounding happens once, inside `prorate`.
 */
export function tuitionForYear(row: PriceListItem, startMonth: number): Fenings {
  if (row.item !== 'TUITION') throw new PricingError(`expected TUITION, got ${row.item}`);
  const entity = PROGRAM_ENTITY[row.program];
  const months = remainingTuitionMonths(entity, startMonth);
  if (row.basis === 'MONTHLY') return row.amount * months;
  if (row.basis === 'ANNUAL') return prorate(row.amount, months, IDSS_TUITION_MONTHS);
  throw new PricingError(`tuition cannot have basis ${row.basis}`);
}

/** A recorded board decision that changes an amount (BR-7). Data only in Sprint 01. */
export type BoardDecisionEffect =
  | { readonly kind: 'DISCOUNT'; readonly discountBp: BasisPoints }
  | { readonly kind: 'FIXED_AMOUNT'; readonly amount: Fenings };

/**
 * Apply a board decision to a price-list amount (BR-7).
 * Never produces a negative amount. A fixed amount replaces the price.
 */
export function applyBoardDecision(amount: Fenings, effect: BoardDecisionEffect): Fenings {
  if (effect.kind === 'DISCOUNT') return applyDiscount(amount, effect.discountBp);
  if (effect.amount < 0) throw new PricingError('board decision amount cannot be negative');
  return effect.amount;
}
