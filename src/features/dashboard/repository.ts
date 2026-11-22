import { z } from 'zod';
import { call, type Result } from '@/lib/tauri/invoke';
import { EnrolmentStatusSchema, ProgramCodeSchema } from '@/lib/validation/schemas';
import type { SchoolYear } from '@/features/price-lists/types';

/** Dashboard and audit-log repository — Infrastructure layer (A-3); both commands are read-only. */

export const EnrolmentOverviewSchema = z.object({
  familyId: z.string(),
  childId: z.string(),
  program: ProgramCodeSchema,
  status: EnrolmentStatusSchema,
});
export type EnrolmentOverview = z.infer<typeof EnrolmentOverviewSchema>;

/** Enrolments of a school year without names (BR-29). */
export function listEnrolmentOverview(schoolYear: SchoolYear): Promise<Result<EnrolmentOverview[]>> {
  return call('list_enrolment_overview', z.array(EnrolmentOverviewSchema), { schoolYear });
}

export const AUDIT_CATEGORIES = ['INVOICES', 'FAMILIES', 'SYSTEM'] as const;
export type AuditCategory = (typeof AUDIT_CATEGORIES)[number];

export interface AuditFilter {
  readonly from: string | null;
  readonly to: string | null;
  readonly category: AuditCategory | null;
  readonly search: string | null;
  readonly limit: number;
  readonly offset: number;
}

export const AuditEntrySchema = z.object({
  id: z.number().int(),
  at: z.string(),
  action: z.string(),
  entity: z.string(),
  entityId: z.string(),
  details: z.string(),
  subject: z.string().nullable(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const AuditPageSchema = z.object({ entries: z.array(AuditEntrySchema), total: z.number().int() });
export type AuditPage = z.infer<typeof AuditPageSchema>;

/** The audit log, newest first (BR-30). There is no command that changes it. */
export function listAuditLog(filter: AuditFilter): Promise<Result<AuditPage>> {
  return call('list_audit_log', AuditPageSchema, { filter });
}
