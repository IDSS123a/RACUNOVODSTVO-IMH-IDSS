import { z } from 'zod';
import { call, type Result } from '@/lib/tauri/invoke';
import {
  BackupResultSchema,
  DatabaseStatusSchema,
  InstitutionSchema,
  InstitutionsSchema,
  MinistryApprovalSchema,
  MinistryApprovalsSchema,
  SettingsSchema,
} from '@/lib/validation/schemas';

/**
 * Settings / institutions / backup repository — Infrastructure layer.
 * Each function is one Tauri command; no business logic here (A-3).
 */

export type DatabaseStatus = z.infer<typeof DatabaseStatusSchema>;
export type Institution = z.infer<typeof InstitutionSchema>;
export type Settings = z.infer<typeof SettingsSchema>;
export type MinistryApproval = z.infer<typeof MinistryApprovalSchema>;
export type BackupResult = z.infer<typeof BackupResultSchema>;

const Nothing = z.null();

/** Status of the encrypted database. */
export function getDatabaseStatus(): Promise<Result<DatabaseStatus>> {
  return call('db_status', DatabaseStatusSchema);
}

/** Recovery key while not yet acknowledged; null afterwards. */
export function getRecoveryKey(): Promise<Result<string | null>> {
  return call('get_recovery_key', z.string().nullable());
}

export function acknowledgeRecoveryKey(): Promise<Result<null>> {
  return call('acknowledge_recovery_key', Nothing);
}

/** Settings, or null before the first save. Invalid stored settings are reported, not ignored. */
export function getSettings(): Promise<Result<Settings | null>> {
  return call('get_settings', SettingsSchema.nullable());
}

export function saveSettings(settings: Settings): Promise<Result<null>> {
  return call('save_settings', Nothing, { settings: SettingsSchema.parse(settings) });
}

export function listInstitutions(): Promise<Result<Institution[]>> {
  return call('list_institutions', InstitutionsSchema);
}

export function saveInstitution(institution: Institution): Promise<Result<null>> {
  return call('save_institution', Nothing, { institution: InstitutionSchema.parse(institution) });
}

export function listMinistryApprovals(): Promise<Result<MinistryApproval[]>> {
  return call('list_ministry_approvals', MinistryApprovalsSchema);
}

export function saveMinistryApproval(approval: MinistryApproval): Promise<Result<null>> {
  return call('save_ministry_approval', Nothing, { approval: MinistryApprovalSchema.parse(approval) });
}

export function createBackup(folder: string): Promise<Result<BackupResult>> {
  return call('create_backup', BackupResultSchema, { folder });
}

export function restoreBackup(filePath: string, recoveryKey: string | null): Promise<Result<null>> {
  return call('restore_backup', Nothing, { filePath, recoveryKey });
}
