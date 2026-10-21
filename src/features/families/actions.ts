import type { Result } from '@/lib/tauri/invoke';
import { canTransition, enrolmentProblems, formatIban, guardianProblems } from './domain';
import { saveEnrolment, saveFamily } from './repository';
import type { Enrolment, EnrolmentStatus, Family, Guardian } from './types';

/**
 * Application layer for families: run domain validation, then persist.
 * Domain problems are returned as a Commander failure result (E-5), never thrown.
 */

function failure(problems: string[]): Result<never> {
  return { success: false, error: problems.join(' '), code: 'VALIDATION' };
}

export async function saveFamilyWithGuardians(family: Family, guardians: Guardian[]): Promise<Result<null>> {
  const problems = guardianProblems(guardians);
  if (problems.length > 0) return failure(problems);
  // Store IBANs in one canonical form so the refund list never shows "BA39_1994…" variants.
  return saveFamily(family, guardians.map((guardian) => ({ ...guardian, iban: formatIban(guardian.iban) })));
}

/** Save an enrolment after checking it against the child's other enrolments. */
export async function saveValidatedEnrolment(enrolment: Enrolment, siblingsOfChild: ReadonlyArray<Enrolment>): Promise<Result<null>> {
  const problems = enrolmentProblems(enrolment, siblingsOfChild);
  if (problems.length > 0) return failure(problems);
  return saveEnrolment(enrolment);
}

/** Change an enrolment's status if the transition is allowed. */
export async function changeEnrolmentStatus(
  enrolment: Enrolment,
  to: EnrolmentStatus,
  others: ReadonlyArray<Enrolment>,
  endsOn: string | null,
): Promise<Result<null>> {
  if (!canTransition(enrolment.status, to)) return failure(['Ova promjena statusa nije dozvoljena.']);
  const next: Enrolment = { ...enrolment, status: to, endsOn: to === 'WITHDRAWN' || to === 'COMPLETED' ? endsOn : enrolment.endsOn };
  return saveValidatedEnrolment(next, others);
}
