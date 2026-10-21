import type { z } from 'zod';
import { call, type Result } from '@/lib/tauri/invoke';
import { LegacyImportResultSchema, LegacyKeysSchema, LegacyWorkbookSchema } from '@/lib/validation/schemas';
import type { ImportPlan, LegacyWorkbook } from './domain';

/** Import from the previous Excel solution — Infrastructure layer (A-3). */

export type LegacyImportResult = z.infer<typeof LegacyImportResultSchema>;
export type LegacyKeys = z.infer<typeof LegacyKeysSchema>;

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
