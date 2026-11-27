import { SCHOOL_YEAR_START_MONTH } from '@/constants';
import type { Fenings } from '@/features/billing/money';
import { assignSiblingTiers, findPrice, PricingError } from '@/features/billing/pricing';
import { PROGRAM_ENTITY, type BillingBasis, type LegalEntityCode, type PriceListItem, type ProgramCode, type SchoolYear, type SiblingTier, PROGRAM_LABEL } from '@/features/price-lists/types';
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
/**
 * Ages a child may have on the first day of a program (completed years). Director, 2026-11-22: a kindergarten
 * enrolment for a child born in 1998 was accepted. These are wide guards against an impossible date; the backend
 * checks the same (`families.rs`). The exact ranges are for the Director to confirm.
 */
export const PROGRAM_AGE: Readonly<Record<ProgramCode, readonly [number, number]>> = {
  // Director, 2026-11-27: Toddlers only until the 4th birthday; Preschoolers from the 2nd birthday (the pedagogue
  // decides when a child moves up, so both groups are allowed between the 2nd and the 4th birthday)
  TODDLERS: [0, 3],
  PRESCHOOLERS: [2, 6],
  IDSS_PRESCHOOLERS: [3, 6],
  PRIMARY_1_4: [5, 11],
  PRIMARY_5_9: [9, 16],
};

/** The group the system proposes for the IMH kindergarten: Toddlers until the 3rd birthday, Preschoolers after it. */
export function suggestedGroup(dateOfBirth: string | null, startsOn: string): 'TODDLERS' | 'PRESCHOOLERS' {
  return dateOfBirth && ageOn(dateOfBirth, startsOn) < 3 ? 'TODDLERS' : 'PRESCHOOLERS';
}

/** The day a child turns `years` (ISO); 29 February becomes 28 February in a common year. */
export function birthday(dateOfBirth: string, years: number): string {
  const year = Number(dateOfBirth.slice(0, 4)) + years;
  const monthDay = dateOfBirth.slice(5);
  const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
  return `${year}-${monthDay === '02-29' && !leap ? '02-28' : monthDay}`;
}

/** Oldest age (completed years) of any child of the institutions on the day the record is saved. */
export const CHILD_MAX_AGE = 16;

/** Completed years between a date of birth and a date (both ISO). */
export function ageOn(dateOfBirth: string, date: string): number {
  const years = Number(date.slice(0, 4)) - Number(dateOfBirth.slice(0, 4));
  return date.slice(5) < dateOfBirth.slice(5) ? years - 1 : years;
}

/** The child's age does not fit the program on its first day; null = fits or the date of birth is not known. */
export function enrolmentAgeProblem(program: ProgramCode, dateOfBirth: string | null, startsOn: string): string | null {
  if (!dateOfBirth) return null;
  const age = ageOn(dateOfBirth, startsOn);
  const [min, max] = PROGRAM_AGE[program];
  if (age >= min && age <= max) return null;
  return `Dijete rođeno ${dateOfBirth.split('-').reverse().join('.')}. ima ${age} god. na dan početka — za ${PROGRAM_LABEL[program]} dozvoljeno je ${min}–${max} god. Provjerite datum rođenja ili program.`;
}

export function enrolmentProblems(enrolment: Enrolment, others: ReadonlyArray<Enrolment>, dateOfBirth: string | null = null): string[] {
  const problems: string[] = [];
  const age = enrolmentAgeProblem(enrolment.program, dateOfBirth, enrolment.startsOn);
  if (age) problems.push(age);
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
