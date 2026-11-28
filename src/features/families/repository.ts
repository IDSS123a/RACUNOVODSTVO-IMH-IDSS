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

/**
 * The operator saved a record although it looked like an existing one (SPEC §B). Written to the audit log with the
 * ids of the families it resembled — no names, telephones or e-mails (BR-22).
 */
export function confirmNotDuplicate(entity: 'family' | 'child', entityId: string, similarFamilyIds: ReadonlyArray<string>): Promise<Result<null>> {
  return call('confirm_not_duplicate', Nothing, { entity, entityId, similarFamilyIds: [...similarFamilyIds] });
}

/**
 * Move an active IMH kindergarten enrolment to the other group (Toddlers ↔ Preschoolers) from a day (SPEC A9). The
 * backend checks the age on that day and writes the change to the audit log; nothing billed changes.
 */
export function changeEnrolmentGroup(enrolmentId: string, program: 'TODDLERS' | 'PRESCHOOLERS', from: string): Promise<Result<null>> {
  return call('change_enrolment_group', Nothing, { enrolmentId, program, from });
}

/** „Upis uvezene djece“: children and their new enrolments in ONE transaction; returns how many were saved. */
export function saveEnrolmentsBulk(items: ReadonlyArray<[Child, Enrolment]>): Promise<Result<number>> {
  return call('save_enrolments_bulk', z.number().int(), {
    items: items.map(([child, enrolment]) => [ChildSchema.parse(child), EnrolmentSchema.parse(enrolment)]),
  });
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
