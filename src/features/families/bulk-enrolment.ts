import { isRealDate } from '@/lib/validation/formats';
import { enrolmentProblems, schoolYearBounds, ageOn, CHILD_MAX_AGE } from './domain';
import type { Child, Enrolment, FamilyDetail } from './types';
import { ENROLLABLE_PROGRAMS, PROGRAM_ENTITY, type LegalEntityCode, type ProgramCode, type SchoolYear } from '@/features/price-lists/types';

/**
 * „Upis uvezene djece“ (Director, 2026-11-21): one invoice per child needs an enrolment, and the old workbook has no
 * program and no date of birth. This screen lists every child without an enrolment in the school year and saves the
 * operator's entries for many children at once (one transaction). Nothing is guessed (M-4):
 * - the institution is only *suggested* from the child's most recent invoice;
 * - program and date of birth are always entered by the operator.
 */

export interface BulkRow {
  readonly child: Child;
  readonly familyName: string;
  /** From the most recent invoice of the child (imported or issued); null when it has none. */
  readonly suggestedEntity: LegalEntityCode | null;
  readonly entity: LegalEntityCode | '';
  readonly program: ProgramCode | '';
  readonly dateOfBirth: string;
  readonly residency: Child['residency'];
  readonly startsOn: string;
  readonly status: 'ACTIVE' | 'AWAITING_ENROLMENT_PAYMENT';
  /** Saved when the operator ticks it. */
  readonly selected: boolean;
}

/** Programs of an institution for a new enrolment (BR-1); Toddlers / Preschoolers is one choice (Director, 2026-11-21). */
export function programsOf(entity: LegalEntityCode): ProgramCode[] {
  return ENROLLABLE_PROGRAMS.filter((p) => PROGRAM_ENTITY[p] === entity);
}

/**
 * One row per child with no enrolment in the school year (any status), in family order.
 * @param lastEntity the institution of each child's most recent invoice
 */
export function bulkRows(
  details: ReadonlyArray<FamilyDetail>,
  schoolYear: SchoolYear,
  lastEntity: ReadonlyMap<string, LegalEntityCode>,
): BulkRow[] {
  const { from } = schoolYearBounds(schoolYear);
  return details.flatMap((detail) =>
    detail.children
      .filter((child) => !detail.enrolments.some((e) => e.childId === child.id && e.schoolYear === schoolYear))
      .map((child) => {
        const suggested = lastEntity.get(child.id) ?? null;
        return {
          child,
          familyName: detail.family.displayName,
          suggestedEntity: suggested,
          entity: suggested ?? '',
          program: '',
          dateOfBirth: child.dateOfBirth ?? '',
          residency: child.residency,
          startsOn: from,
          status: 'ACTIVE',
          selected: false,
        } satisfies BulkRow;
      }),
  );
}

/** The institution of every child's most recent invoice (credit notes excluded). */
export function lastEntityByChild(
  invoices: ReadonlyArray<{ readonly childId: string; readonly entity: LegalEntityCode; readonly kind: string; readonly issueDate: string }>,
): Map<string, LegalEntityCode> {
  const latest = new Map<string, { entity: LegalEntityCode; issueDate: string }>();
  for (const invoice of invoices) {
    if (!invoice.childId || invoice.kind === 'CREDIT_NOTE') continue;
    const seen = latest.get(invoice.childId);
    if (!seen || invoice.issueDate > seen.issueDate) latest.set(invoice.childId, { entity: invoice.entity, issueDate: invoice.issueDate });
  }
  return new Map([...latest].map(([childId, v]) => [childId, v.entity]));
}

/** What is still missing or wrong in a row (empty = can be saved). */
export function rowProblems(row: BulkRow, schoolYear: SchoolYear, today: string): string[] {
  const problems: string[] = [];
  if (!row.entity) problems.push('odaberite ustanovu');
  if (!row.program) problems.push('odaberite program');
  else if (row.entity && PROGRAM_ENTITY[row.program] !== row.entity) problems.push('program ne pripada ustanovi');
  if (!isRealDate(row.dateOfBirth)) problems.push('unesite datum rođenja');
  else if (row.dateOfBirth >= today) problems.push('datum rođenja mora biti u prošlosti');
  else if (ageOn(row.dateOfBirth, today) > CHILD_MAX_AGE) problems.push(`dijete bi imalo ${ageOn(row.dateOfBirth, today)} god. — provjerite datum rođenja`);
  if (row.program) {
    const dateOfBirth = isRealDate(row.dateOfBirth) && row.dateOfBirth < today ? row.dateOfBirth : null;
    problems.push(...enrolmentProblems(toEnrolment(row, schoolYear, 'x'), [], dateOfBirth).map((p) => p.replace(/\.$/, '')));
  }
  return problems;
}

function toEnrolment(row: BulkRow, schoolYear: SchoolYear, id: string): Enrolment {
  if (!row.program) throw new Error('program missing');
  return { id, childId: row.child.id, program: row.program, schoolYear, startsOn: row.startsOn, endsOn: null, status: row.status };
}

/** The (child, enrolment) pairs to save: ticked rows without problems. The child's review flag is cleared by saving. */
export function bulkItems(rows: ReadonlyArray<BulkRow>, schoolYear: SchoolYear, today: string, newId: () => string): Array<[Child, Enrolment]> {
  return rows
    .filter((row) => row.selected && rowProblems(row, schoolYear, today).length === 0)
    .map((row) => [
      { ...row.child, dateOfBirth: row.dateOfBirth, residency: row.residency, importReview: false },
      toEnrolment(row, schoolYear, newId()),
    ]);
}
