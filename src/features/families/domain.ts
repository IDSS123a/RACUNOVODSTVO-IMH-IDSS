import { SCHOOL_YEAR_START_MONTH } from '@/constants';
import type { Fenings } from '@/features/billing/money';
import { assignSiblingTiers, findPrice, PricingError } from '@/features/billing/pricing';
import {
  PROGRAM_ENTITY,
  type BillingBasis,
  type LegalEntityCode,
  type PriceListItem,
  type ProgramCode,
  type SchoolYear,
  type SiblingTier,
} from '@/features/price-lists/types';
import type { Child, Enrolment, EnrolmentStatus, Guardian } from './types';

/**
 * Family domain rules (Sprint 02). Pure functions — no Tauri, no React.
 */

/** Statuses that count as "currently enrolled" for sibling order and uniqueness. */
export const ACTIVE_STATUSES: ReadonlySet<EnrolmentStatus> = new Set([
  'AWAITING_ENROLMENT_PAYMENT',
  'ACTIVE',
  'WITHDRAWAL_NOTIFIED',
  'SUSPENDED',
]);

/** Allowed status transitions (CONSTITUTION BR-9, BR-13–BR-15). */
const TRANSITIONS: Readonly<Record<EnrolmentStatus, ReadonlyArray<EnrolmentStatus>>> = {
  AWAITING_ENROLMENT_PAYMENT: ['ACTIVE', 'WITHDRAWN'],
  ACTIVE: ['WITHDRAWAL_NOTIFIED', 'SUSPENDED', 'COMPLETED'],
  WITHDRAWAL_NOTIFIED: ['ACTIVE', 'WITHDRAWN'],
  SUSPENDED: ['ACTIVE', 'WITHDRAWN'],
  WITHDRAWN: [],
  COMPLETED: [],
};

/** Status transitions available from a given status. */
export function allowedTransitions(from: EnrolmentStatus): ReadonlyArray<EnrolmentStatus> {
  return TRANSITIONS[from];
}

export function canTransition(from: EnrolmentStatus, to: EnrolmentStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Remove separators people type into IBANs (spaces, dashes, underscores, dots). */
export function compactIban(value: string): string {
  return value.replace(/[\s\-_.]/g, '').toUpperCase();
}

/** Canonical display form: groups of four, e.g. "BA39 1994 9900 2180 9884". Empty stays empty. */
export function formatIban(value: string): string {
  const compact = compactIban(value);
  return compact.replace(/(.{4})/g, '$1 ').trim();
}

/**
 * Validate a Bosnian IBAN (BA + 2 check digits + 16 digits) with the ISO 13616 mod-97 check.
 * Optional: empty is allowed. It is needed only for ministry-subsidy refunds (IMH, BiH citizens).
 * WHY still check digits: a typo would send the refund to someone else's account.
 */
export function isValidIban(value: string): boolean {
  const compact = compactIban(value);
  if (compact === '') return true;
  if (!/^BA\d{18}$/.test(compact)) return false;
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - 55));
  let remainder = 0;
  for (const digit of numeric) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder === 1;
}

/** Problems with a family's guardians, as Bosnian messages for the UI. */
export function guardianProblems(guardians: ReadonlyArray<Guardian>): string[] {
  const problems: string[] = [];
  const payers = guardians.filter((guardian) => guardian.isPayer);
  if (guardians.length === 0) problems.push('Dodajte barem jednog roditelja ili staratelja.');
  else if (payers.length === 0) problems.push('Označite roditelja koji plaća (prima račune).');
  else if (payers.length > 1) problems.push('Samo jedan roditelj može biti platilac.');
  for (const role of ['MOTHER', 'FATHER'] as const) {
    if (guardians.filter((guardian) => guardian.role === role).length > 1) {
      problems.push(role === 'MOTHER' ? 'Porodica može imati samo jednu majku — za drugu osobu odaberite „Staratelj“.' : 'Porodica može imati samo jednog oca — za drugu osobu odaberite „Staratelj“.');
    }
  }
  for (const guardian of guardians) {
    if (!isValidIban(guardian.iban)) problems.push(`IBAN za „${guardian.fullName}“ nije ispravan.`);
  }
  return problems;
}

/** First and last day of a school year, e.g. 2026/2027 → 2026-09-01 … 2027-08-31. */
export function schoolYearBounds(year: SchoolYear): { from: string; to: string } {
  const [start] = year.split('/').map(Number);
  if (start === undefined || Number.isNaN(start)) throw new Error(`invalid school year ${year}`);
  const month = String(SCHOOL_YEAR_START_MONTH).padStart(2, '0');
  return { from: `${start}-${month}-01`, to: `${start + 1}-08-31` };
}

/**
 * Problems with an enrolment against the child's other enrolments.
 * One active enrolment per child, legal entity and school year (BR-1, BR-6).
 */
export function enrolmentProblems(enrolment: Enrolment, others: ReadonlyArray<Enrolment>): string[] {
  const problems: string[] = [];
  const { from, to } = schoolYearBounds(enrolment.schoolYear as SchoolYear);
  if (enrolment.startsOn < from || enrolment.startsOn > to) {
    problems.push(`Datum početka mora biti unutar školske godine ${enrolment.schoolYear}.`);
  }
  if (enrolment.endsOn !== null && enrolment.endsOn < enrolment.startsOn) {
    problems.push('Datum završetka ne može biti prije datuma početka.');
  }
  if (ACTIVE_STATUSES.has(enrolment.status)) {
    const entity = PROGRAM_ENTITY[enrolment.program];
    const clash = others.find(
      (other) =>
        other.id !== enrolment.id &&
        other.childId === enrolment.childId &&
        other.schoolYear === enrolment.schoolYear &&
        PROGRAM_ENTITY[other.program] === entity &&
        ACTIVE_STATUSES.has(other.status),
    );
    if (clash) problems.push(`Dijete već ima aktivan upis u ${entity} za ${enrolment.schoolYear}.`);
  }
  return problems;
}

/** One line of the family pricing summary. */
export interface FamilyPricingLine {
  readonly childId: string;
  readonly childName: string;
  readonly dateOfBirth: string | null;
  readonly entity: LegalEntityCode;
  readonly program: ProgramCode;
  readonly tier: SiblingTier;
  readonly basis: BillingBasis | null;
  readonly tuition: Fenings | null;
  /** Bosnian reason when the price cannot be determined (never a guessed amount — M-4). */
  readonly problem: string | null;
}

/**
 * Who pays the full price and who the discounted one, per legal entity, for one school year.
 * Uses the Sprint 01 pricing engine: oldest child pays full, younger children get the tier discount.
 */
export function buildFamilyPricing(
  children: ReadonlyArray<Child>,
  enrolments: ReadonlyArray<Enrolment>,
  priceItems: ReadonlyArray<PriceListItem>,
  schoolYear: SchoolYear,
): FamilyPricingLine[] {
  const childById = new Map(children.map((child) => [child.id, child]));
  const active = enrolments.filter((e) => e.schoolYear === schoolYear && ACTIVE_STATUSES.has(e.status) && childById.has(e.childId));
  const undated = active.map((e) => childById.get(e.childId)).find((c) => c && !c.dateOfBirth);
  const tiers = undated
    ? new Map<string, SiblingTier>()
    : assignSiblingTiers(active.map((e) => ({ childId: e.childId, dateOfBirth: childById.get(e.childId)?.dateOfBirth ?? '', program: e.program })));
  return active
    .map((enrolment): FamilyPricingLine => {
      const child = childById.get(enrolment.childId);
      if (!child) throw new Error('unreachable: filtered above');
      const tier = tiers.get(enrolment.childId) ?? 'FIRST';
      const base = {
        childId: child.id,
        childName: `${child.firstName} ${child.lastName}`,
        dateOfBirth: child.dateOfBirth,
        entity: PROGRAM_ENTITY[enrolment.program],
        program: enrolment.program,
        tier,
      };
      if (undated) {
        return { ...base, basis: null, tuition: null, problem: `Redoslijed djece nije poznat: ${undated.firstName} ${undated.lastName} nema datum rođenja.` };
      }
      try {
        const row = findPrice(priceItems, { schoolYear, program: enrolment.program, item: 'TUITION', residency: child.residency, tier });
        return { ...base, basis: row.basis, tuition: row.amount, problem: null };
      } catch (error: unknown) {
        if (!(error instanceof PricingError)) throw error;
        return { ...base, basis: null, tuition: null, problem: `Nema cijene u cjenovniku ${schoolYear}.` };
      }
    })
    .sort((a, b) => a.entity.localeCompare(b.entity) || (a.dateOfBirth ?? '').localeCompare(b.dateOfBirth ?? ''));
}

/**
 * Date of birth needed for sibling order and pricing (BR-6). Imported children (BR-32) may not have it yet:
 * billing such a child is refused with a clear message instead of guessing the order.
 */
export function knownBirthDate(child: Child): string {
  if (!child.dateOfBirth) throw new PricingError(`${child.firstName} ${child.lastName}: nema datum rođenja — dopunite podatke djeteta`);
  return child.dateOfBirth;
}
