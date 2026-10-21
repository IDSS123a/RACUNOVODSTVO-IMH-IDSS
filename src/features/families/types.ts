import type { z } from 'zod';
import type {
  ChildSchema,
  EnrolmentSchema,
  EnrolmentStatusSchema,
  FamilyDetailSchema,
  FamilySchema,
  FamilySummarySchema,
  GuardianRoleSchema,
  GuardianSchema,
} from '@/lib/validation/schemas';

/** Family-domain types, inferred from the single schema source (E-2). */
export type Family = z.infer<typeof FamilySchema>;
export type Guardian = z.infer<typeof GuardianSchema>;
export type GuardianRole = z.infer<typeof GuardianRoleSchema>;
export type Child = z.infer<typeof ChildSchema>;
export type Enrolment = z.infer<typeof EnrolmentSchema>;
export type EnrolmentStatus = z.infer<typeof EnrolmentStatusSchema>;
export type FamilySummary = z.infer<typeof FamilySummarySchema>;
export type FamilyDetail = z.infer<typeof FamilyDetailSchema>;

export const ROLE_LABEL: Readonly<Record<GuardianRole, string>> = {
  MOTHER: 'Majka',
  FATHER: 'Otac',
  GUARDIAN: 'Staratelj',
};

export const STATUS_LABEL: Readonly<Record<EnrolmentStatus, string>> = {
  AWAITING_ENROLMENT_PAYMENT: 'Čeka upisne uplate',
  ACTIVE: 'Aktivan',
  WITHDRAWAL_NOTIFIED: 'Najavljen ispis',
  WITHDRAWN: 'Ispisan',
  SUSPENDED: 'Suspendovan',
  COMPLETED: 'Završen',
};
