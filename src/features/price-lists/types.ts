import type { Fenings } from '@/features/billing/money';

/**
 * Price-list domain types (CONSTITUTION §4.1–4.4, DL-P005).
 * String unions instead of enums because tsconfig has `erasableSyntaxOnly`.
 */

/** The two legal entities — never mixed (BR-1, BR-6). */
export type LegalEntityCode = 'IMH' | 'IDSS';

/** Programs; each belongs to exactly one legal entity (BR-1). */
export type ProgramCode =
  | 'TODDLERS'
  | 'PRESCHOOLERS'
  | 'IDSS_PRESCHOOLERS'
  | 'PRIMARY_1_4'
  | 'PRIMARY_5_9';

/** Price column: domestic (BiH) vs foreign persons. */
export type Residency = 'DOMESTIC' | 'FOREIGN';

/** Billable items found in the official price lists. */
export type PriceItemCode =
  | 'ENROLMENT_FEE'
  | 'ENROLMENT_FEE_AFTER_IDSS_PRESCHOOL'
  | 'MATERIALS'
  | 'DEPOSIT'
  | 'TUITION'
  | 'EXTENDED_STAY'
  | 'BREAKFAST';

/**
 * Sibling tier within ONE legal entity, ordered oldest → youngest (BR-6, D11).
 * IMH uses FIRST / SUBSEQUENT; IDSS uses FIRST / SECOND / THIRD_PLUS.
 * ANY means the item has no sibling discount.
 */
export type SiblingTier = 'ANY' | 'FIRST' | 'SUBSEQUENT' | 'SECOND' | 'THIRD_PLUS';

/** How the amount is expressed in the source document. */
export type BillingBasis = 'ONE_TIME' | 'MONTHLY' | 'ANNUAL';

/** School year key, e.g. "2026/2027". */
export type SchoolYear = `${number}/${number}`;

/** One row of an official price list. */
export interface PriceListItem {
  readonly schoolYear: SchoolYear;
  readonly program: ProgramCode;
  readonly item: PriceItemCode;
  readonly residency: Residency;
  readonly tier: SiblingTier;
  readonly basis: BillingBasis;
  readonly amount: Fenings;
  /** Document and article the amount was transcribed from (M-4 traceability). */
  readonly source: string;
}

/** Program → legal entity (BR-1). Single source of this mapping. */
export const PROGRAM_ENTITY: Readonly<Record<ProgramCode, LegalEntityCode>> = {
  TODDLERS: 'IMH',
  PRESCHOOLERS: 'IMH',
  IDSS_PRESCHOOLERS: 'IMH',
  PRIMARY_1_4: 'IDSS',
  PRIMARY_5_9: 'IDSS',
};

/**
 * Bosnian labels for the UI. Toddlers and Preschoolers are ONE choice (Director, 2026-11-21): same price, and a child
 * moves from one to the other during the year on the pedagogue's assessment. Both codes stay valid for stored data
 * and the price list; they read the same everywhere.
 */
export const PROGRAM_LABEL: Readonly<Record<ProgramCode, string>> = {
  TODDLERS: 'Toddlers / Preschoolers',
  PRESCHOOLERS: 'Toddlers / Preschoolers',
  IDSS_PRESCHOOLERS: 'IDSS Preschoolers',
  PRIMARY_1_4: 'Osnovna škola I–IV',
  PRIMARY_5_9: 'Osnovna škola V–IX',
};

/** Programs offered for a NEW enrolment: Toddlers / Preschoolers once (stored as PRESCHOOLERS). */
export const ENROLLABLE_PROGRAMS: ReadonlyArray<ProgramCode> = ['PRESCHOOLERS', 'IDSS_PRESCHOOLERS', 'PRIMARY_1_4', 'PRIMARY_5_9'];

/** The program choices for a form: the enrollable ones, plus the stored one if it is the other Toddlers/Preschoolers code. */
export function programChoices(current: ProgramCode | ''): ProgramCode[] {
  return current && !ENROLLABLE_PROGRAMS.includes(current) ? [current, ...ENROLLABLE_PROGRAMS.filter((p) => p !== 'PRESCHOOLERS')] : [...ENROLLABLE_PROGRAMS];
}

/** Same group for billing rules: Toddlers and Preschoolers are one IMH program (Director, 2026-11-21). */
export function isToddlersOrPreschoolers(program: ProgramCode): boolean {
  return program === 'TODDLERS' || program === 'PRESCHOOLERS';
}

export const ITEM_LABEL: Readonly<Record<PriceItemCode, string>> = {
  ENROLMENT_FEE: 'Upisnina',
  ENROLMENT_FEE_AFTER_IDSS_PRESCHOOL: 'Upisnina (nakon IDSS predškolske grupe)',
  MATERIALS: 'Participacija za potrošni materijal',
  DEPOSIT: 'Depozit',
  TUITION: 'Školarina',
  EXTENDED_STAY: 'Produženi boravak',
  BREAKFAST: 'Doručak',
};

export const TIER_LABEL: Readonly<Record<SiblingTier, string>> = {
  ANY: '—',
  FIRST: 'Prvo (najstarije) dijete',
  SUBSEQUENT: 'Drugo i svako naredno',
  SECOND: 'Drugo dijete',
  THIRD_PLUS: 'Treće i svako naredno',
};

export const BASIS_LABEL: Readonly<Record<BillingBasis, string>> = {
  ONE_TIME: 'jednokratno',
  MONTHLY: 'mjesečno',
  ANNUAL: 'godišnje',
};
