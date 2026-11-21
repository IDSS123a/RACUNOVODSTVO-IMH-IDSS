import { z } from 'zod';
import { call, type Result } from '@/lib/tauri/invoke';
import { ImportFindingRowSchema, LegacyImportResultSchema, LegacyKeysSchema, LegacyWorkbookSchema, ResolutionNoteSchema } from '@/lib/validation/schemas';
import type { ImportPlan, LegacyWorkbook } from './domain';

/** Import from the previous Excel solution — Infrastructure layer (A-3). */

export type LegacyImportResult = z.infer<typeof LegacyImportResultSchema>;
export type LegacyKeys = z.infer<typeof LegacyKeysSchema>;
export type ImportFindingRow = z.infer<typeof ImportFindingRowSchema>;

/** Read sheets DB and Setting (cell values only — macros are never run). */
export function readLegacyWorkbook(path: string): Promise<Result<LegacyWorkbook>> {
  return call('read_legacy_workbook', LegacyWorkbookSchema, { path });
}

export function legacyImportKeys(): Promise<Result<LegacyKeys>> {
  return call('legacy_import_keys', LegacyKeysSchema);
}

/** Write the plan in one backend transaction (audited). */
export function importLegacy(plan: ImportPlan, fileName: string): Promise<Result<LegacyImportResult>> {
  return call('import_legacy', LegacyImportResultSchema, { plan, fileName });
}

/** Stored findings of the legacy import (migration 009); `onlyOpen` hides resolved ones. */
export function listImportFindings(onlyOpen: boolean): Promise<Result<ImportFindingRow[]>> {
  return call('list_import_findings', z.array(ImportFindingRowSchema), { onlyOpen });
}

/** Open ISOLATE + REVIEW findings (kept visible in the menu — Director, Q4). */
export function importFindingsOpenCount(): Promise<Result<number>> {
  return call('import_findings_open_count', z.number().int().nonnegative());
}

/** Mark a finding resolved with the operator's note (validated here and in the backend; audited). */
export async function resolveImportFinding(findingId: string, note: string): Promise<Result<null>> {
  const parsed = ResolutionNoteSchema.safeParse(note);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'neispravna bilješka', code: 'VALIDATION' };
  return call('resolve_import_finding', z.null(), { findingId, note: parsed.data });
}
