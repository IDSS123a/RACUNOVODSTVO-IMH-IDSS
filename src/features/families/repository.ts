import { z } from 'zod';
import { call, type Result } from '@/lib/tauri/invoke';
import {
  ChildSchema,
  EnrolmentSchema,
  FamilyDetailSchema,
  FamilySchema,
  FamilySummariesSchema,
  GuardianSchema,
} from '@/lib/validation/schemas';
import type { Child, Enrolment, Family, FamilyDetail, FamilySummary, Guardian } from './types';

/** Families repository — Infrastructure layer (A-3). One function per Tauri command. */

const Nothing = z.null();

export function listFamilies(): Promise<Result<FamilySummary[]>> {
  return call('list_families', FamilySummariesSchema);
}

export function getFamily(familyId: string): Promise<Result<FamilyDetail>> {
  return call('get_family', FamilyDetailSchema, { familyId });
}

export function saveFamily(family: Family, guardians: Guardian[]): Promise<Result<null>> {
  return call('save_family', Nothing, {
    family: FamilySchema.parse(family),
    guardians: z.array(GuardianSchema).parse(guardians),
  });
}

export function saveChild(child: Child): Promise<Result<null>> {
  return call('save_child', Nothing, { child: ChildSchema.parse(child) });
}

export function saveEnrolment(enrolment: Enrolment): Promise<Result<null>> {
  return call('save_enrolment', Nothing, { enrolment: EnrolmentSchema.parse(enrolment) });
}

export function deleteChild(childId: string): Promise<Result<null>> {
  return call('delete_child', Nothing, { childId });
}

export function deleteEnrolment(enrolmentId: string): Promise<Result<null>> {
  return call('delete_enrolment', Nothing, { enrolmentId });
}

export function deleteFamily(familyId: string): Promise<Result<null>> {
  return call('delete_family', Nothing, { familyId });
}
