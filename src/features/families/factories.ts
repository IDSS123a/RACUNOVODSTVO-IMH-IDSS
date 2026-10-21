import type { SchoolYear } from '@/features/price-lists/types';
import { schoolYearBounds } from './domain';
import type { Child, Enrolment, Guardian } from './types';

/** Blank records for "new" forms. IDs are generated client-side (UUID v4). */

export function newGuardian(familyId: string, isPayer: boolean): Guardian {
  return { id: crypto.randomUUID(), familyId, fullName: '', role: 'MOTHER', email: '', phone: '', iban: '', isPayer };
}

export function newChild(familyId: string, lastName: string): Child {
  return {
    id: crypto.randomUUID(),
    familyId,
    firstName: '',
    lastName,
    dateOfBirth: '',
    residency: 'DOMESTIC',
    citizenBih: true,
    residenceKs: true,
  };
}

/** A new enrolment starts at the beginning of the school year, awaiting enrolment payments (BR-9). */
export function newEnrolment(childId: string, schoolYear: SchoolYear): Enrolment {
  return {
    id: crypto.randomUUID(),
    childId,
    program: 'TODDLERS',
    schoolYear,
    startsOn: schoolYearBounds(schoolYear).from,
    endsOn: null,
    status: 'AWAITING_ENROLMENT_PAYMENT',
  };
}
