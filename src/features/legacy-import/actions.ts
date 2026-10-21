import type { Result } from '@/lib/tauri/invoke';
import { buildImportPlan, LegacyImportError, type ImportPlan, type ImportReport } from './domain';
import { importLegacy, legacyImportKeys, readLegacyWorkbook, type LegacyImportResult } from './repository';

/** Application layer for the legacy import (BR-32): read → plan + report (preview) → import. */

export interface PreparedImport {
  readonly plan: ImportPlan;
  readonly report: ImportReport;
}

export async function prepareLegacyImport(path: string): Promise<Result<PreparedImport>> {
  const [workbook, keys] = await Promise.all([readLegacyWorkbook(path), legacyImportKeys()]);
  if (!workbook.success) return workbook;
  if (!keys.success) return keys;
  try {
    const prepared = buildImportPlan(
      workbook.data,
      {
        families: new Map(keys.data.families),
        children: new Map(keys.data.children),
        invoices: new Map(keys.data.invoices.map(([number, id, paid]) => [number, { id, paid }])),
      },
      () => crypto.randomUUID(),
    );
    return { success: true, data: prepared };
  } catch (error: unknown) {
    if (error instanceof LegacyImportError) return { success: false, error: error.message, code: 'VALIDATION' };
    throw error;
  }
}

export function runLegacyImport(prepared: PreparedImport): Promise<Result<LegacyImportResult>> {
  return importLegacy(prepared.plan, prepared.report.fileName);
}
