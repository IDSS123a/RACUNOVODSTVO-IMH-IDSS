# PLAN — Legacy import diagnostics

*FEATURE_LIFECYCLE Step 2 · from SPEC.md (decisions Q1–Q4 of 2026-11-21) · Commander v1.6.2*

## Architecture
Five layers (A-1), following the existing legacy-import feature:
- **Domain** (`src/features/legacy-import/diagnostics.ts`, new; `domain.ts` changed) — pure TypeScript.
  - `buildImportPlan` collects a typed `Finding` for every category in SPEC.md instead of free-text warnings.
  - A finding carries: category code, severity, entity, invoice number, Excel rows, a short reason, and the amount where one applies.
  - BLOCK findings throw `LegacyImportError` (listing every one, not only the first). ISOLATE findings remove the invoice from the plan. REVIEW / INFO findings leave numbers and amounts untouched (BR-32).
  - Q1: an invoice with „plaćeno“ on only some lines gets one payment equal to the sum of the flagged lines, plus a REVIEW finding.
  - The Excel report is built in the domain as bytes: a summary sheet plus one sheet per category. Every cell is an inline string or a number, never a formula (E-4). It is packed with `fflate`, which is already a dependency, so no new dependency is added (M-12).
- **Application** (`actions.ts`) — unchanged contract: prepare → preview → import. In phase B the findings travel with the plan, so the backend can store them.
- **Infrastructure** (Rust, phase B):
  - migration 009 adds `legacy_import_findings`;
  - `legacy::import` stores the findings in the same transaction;
  - new commands `list_import_findings` and `resolve_import_finding` (audited, BR-30);
  - `save_document` also accepts `.xlsx`.
- **Presentation** — the preview lists findings by severity and category, with counts; „Sačuvaj izvještaj (Excel)“. In phase B: a „Za provjeru“ view with an unresolved count and a resolve action.

## Data Model (phase B — migration 009, never edit 001–008)
`legacy_import_findings`

| Column | Notes |
|---|---|
| `id` | TEXT PK |
| `category` | TEXT, CHECK in the category list |
| `severity` | TEXT, CHECK in REVIEW / INFO / ISOLATE |
| `entity` | TEXT |
| `number` | TEXT |
| `invoice_id` | TEXT NULL → `invoices(id)` ON DELETE RESTRICT (A-10). NULL for isolated invoices, which do not exist in the app. |
| `excel_rows` | TEXT |
| `reason` | TEXT. No personal data (BR-22); the UI joins names from the invoice. |
| `amount` | INTEGER NULL (fenings) |
| `first_seen_at` | TEXT |
| `last_seen_file` | TEXT |
| `resolved_at` | TEXT NULL |
| `resolution_note` | TEXT NOT NULL DEFAULT '' |

- UNIQUE(`category`, `entity`, `number`). The key does not contain Excel rows, because rows shift between workbook versions.
- Re-import on go-live day upserts by that key. It keeps `resolved_at` and `resolution_note`, and refreshes `excel_rows` and `last_seen_file`.
- A finding no longer present in the newer workbook stays, marked by an older `last_seen_file`. Nothing is deleted.

## API / Commands (E-6: validate → execute → persist → return; single operator, no auth layer — DL-P002)
- `import_legacy(plan, fileName)` — phase B: plan gains `findings[]`, validated in Rust (category/severity whitelist), stored in the same transaction.
- `list_import_findings(onlyUnresolved)` → findings joined to invoice number, buyer and child (read only).
- `resolve_import_finding(id, note)` → sets `resolved_at`, `resolution_note`; audit `RESOLVE import_finding <id>`; note required (non-empty).
- `save_document` — `.xlsx` added to the allowed extensions.
- Zod schemas for all new payloads in `src/lib/validation/schemas.ts` (E-2).

## Rule Constraints Applied
- **BR-32 / M-4** — REVIEW and INFO never change an imported number or amount; Q1 is the only booking rule, and the Director decided it.
- **E-5** — no silent outcome: every skip, isolation, rounding or default appears as exactly one finding.
- **BR-22 / M-15** — finding reasons hold no names. Test fixtures are fictional. The real workbook is profiled with counts only (L-S3-05).
- **E-4** — the Excel report writes no formulas; text is always an inline string.
- **M-12** — no new dependency (`fflate` is reused).
- **A-10** — the finding → invoice FK is RESTRICT; findings are never deleted.
- **M-7** — the category list lives once, in `diagnostics.ts`, and is mirrored by the migration CHECK.
- **BR-30** — resolving is audited.

## Risks / Deviations
- **Phase B needs the Rust toolchain**, which is not installed on the developer PC (2026-11-21). Phase A (domain, preview, report bytes, tests) needs none. Phase B is not started until `cargo test` can run, so no unverified Rust is committed.
- Categories measured on the example workbook: the go-live workbook will be larger. Detection rules are written generally, and the counts in SPEC.md are evidence, not limits.
- Commander drift: the project is pinned to v1.6.2, Commander is v1.8.1. Not upgraded inside this feature (Director decision).
