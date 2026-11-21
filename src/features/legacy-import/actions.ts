import { save } from '@tauri-apps/plugin-dialog';
import { z } from 'zod';
import { call, type Result } from '@/lib/tauri/invoke';
import { buildFindingsWorkbook, FINDING_CATEGORIES, type Finding, type FindingCategory } from './diagnostics';
import { buildImportPlan, LegacyImportError, type ImportPlan, type ImportReport } from './domain';
import { importLegacy, legacyImportKeys, listImportFindings, readLegacyWorkbook, type ImportFindingRow, type LegacyImportResult } from './repository';

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

const isCategory = (value: string): value is FindingCategory => Object.prototype.hasOwnProperty.call(FINDING_CATEGORIES, value);

/** A stored finding in the shape of the report (unknown categories are dropped — they cannot exist after migration 009). */
export function rowToFinding(row: ImportFindingRow): Finding | null {
  if (!isCategory(row.category)) return null;
  const resolved = row.resolvedAt ? ` [riješeno ${row.resolvedAt.slice(0, 10)}: ${row.resolutionNote}]` : '';
  return {
    category: row.category,
    severity: row.severity,
    entity: row.entity,
    number: row.number,
    excelRows: row.excelRows,
    reason: row.reason + resolved,
    amount: row.amount,
  };
}

/**
 * Save the findings as an Excel report for the accountant (Q3) where the operator chooses.
 * @returns the saved path, or null when the dialog was cancelled
 */
export async function saveFindingsReport(findings: ReadonlyArray<Finding>, sourceName: string): Promise<Result<string | null>> {
  const date = new Date().toISOString().slice(0, 10);
  const bytes = buildFindingsWorkbook(findings, { fileName: sourceName, date });
  let path: string | null;
  try {
    path = await save({ defaultPath: `nalazi-uvoza-${date}.xlsx`, filters: [{ name: 'Excel', extensions: ['xlsx'] }] });
  } catch (error: unknown) {
    return { success: false, error: `dijalog za spremanje nije otvoren: ${String(error)}`, code: 'DIALOG' };
  }
  if (!path) return { success: true, data: null };
  const result = await call('save_document', z.null(), { path, bytes: Array.from(bytes), reference: `izvještaj o uvozu (${findings.length} nalaza)` });
  return result.success ? { success: true, data: path } : result;
}

/** The stored findings (all, including resolved) as the accountant's report. */
export async function saveStoredFindingsReport(): Promise<Result<string | null>> {
  const rows = await listImportFindings(false);
  if (!rows.success) return rows;
  const findings = rows.data.map(rowToFinding).filter((f): f is Finding => f !== null);
  const source = rows.data[0]?.lastSeenFile ?? 'uvoz';
  return saveFindingsReport(findings, source);
}
