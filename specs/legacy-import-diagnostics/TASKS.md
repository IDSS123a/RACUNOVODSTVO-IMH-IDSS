# TASKS — Legacy import diagnostics

*From PLAN.md. Phase A needs no Rust; phase B starts only when `cargo test` runs on the developer PC.*

## Phase A — detection, categories, preview, report
- [x] 1. Database migration — *omitted in phase A* (no schema change; see phase B)
- [x] 2. Types — `Finding`, `FindingCategory`, `Severity` in `src/features/legacy-import/diagnostics.ts`
- [x] 3. Zod — *omitted in phase A* (findings do not cross the IPC boundary yet)
- [x] 4. Repository — *omitted in phase A* (no new command)
- [x] 5. Domain:
  - detect all 31 categories in `buildImportPlan`;
  - BLOCK throws with all blocking findings;
  - ISOLATE removes the invoice;
  - Q1 payment of flagged lines;
  - Excel report bytes (summary + one sheet per category, no formulas).
- [x] 6. Application — `actions.ts` passes findings through the preview
- [x] 7. UI — preview grouped by severity and category, with counts
- [x] 8. Integration — preview wired (report bytes built and verified; the save button arrives in phase B, which needs `.xlsx` in `save_document`)
- [x] 9. Self-review (Step 4)
- [x] 10. Testing:
  - one constructed-workbook test per category;
  - re-run on the example workbook (counts only) against SPEC.md
- [x] 11. Documentation — JSDoc, SPRINT note, lessons
- [x] 12. Commit on branch `fix/legacy-import-integrity` (no push without the Director)


*Phase A verified 2026-11-21: 169/169 Vitest, tsc, ESLint, project-guard clean; on the example workbook: 1.569 invoices, 1.284 payments, 2 isolated, 251 findings in 16 categories; the generated report opens in SheetJS (18 sheets).*

## Phase B — persistence and review (Rust)
- [x] 1. Migration 009 `legacy_import_findings`
- [x] 2. Types — Rust structs
- [x] 3. Zod for the new commands
- [x] 4. Rust repository:
  - store findings in `legacy::import`;
  - `list_import_findings`;
  - `resolve_import_finding` (audited)
- [x] 5. Domain — upsert rules on re-import
- [x] 6. Commands, and `.xlsx` in `save_document`
- [x] 7. UI — „Za provjeru“ view with the unresolved count; resolve with a note; „Sačuvaj izvještaj (Excel)“
- [x] 8. Integration
- [x] 9.–12. Self-review, `cargo test` + Vitest, docs, commit

*Phase B verified 2026-11-21: cargo test 35/35 (2 ignored real-data tests run by hand), Vitest 172/172, tsc, ESLint, project-guard.
End to end on the example workbook — Rust reader → TypeScript plan → Rust import in memory: 1.569 invoices, 1.284 payments,
251 findings stored, 244 linked to their invoice, 91 open (2 ISOLATE + 89 REVIEW), 0 foreign-key violations.*
