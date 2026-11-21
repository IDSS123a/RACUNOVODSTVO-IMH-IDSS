-- 009: findings of the legacy import (specs/legacy-import-diagnostics, Director 2026-11-21).
-- Every inconsistency found while importing the old workbook is kept here so the operator can
-- resolve it after go-live (Q4). Findings are never deleted; a re-import updates them by
-- finding_key and keeps the resolution. Reasons hold no personal data (BR-22).
-- The category list mirrors FINDING_CATEGORIES in src/features/legacy-import/diagnostics.ts (M-7).
-- BLOCK findings are never stored: they stop the import.
-- Rollback: DROP TABLE legacy_import_findings;

CREATE TABLE legacy_import_findings (
  id              TEXT PRIMARY KEY,
  finding_key     TEXT NOT NULL UNIQUE,
  category        TEXT NOT NULL CHECK (category IN (
                    'NUMBER_REUSED_OTHER_PARTY','NUMBER_REUSED_SAME_PARTY','NO_BUYER','ISSUE_DATE_INVALID',
                    'INVOICE_WITHOUT_LINES','REGISTER_ROW_WITHOUT_PARENTS',
                    'DUE_DATE_INVALID','PERIOD_INVALID','NUMBER_YEAR_MISMATCH','ISSUE_DATE_IN_FUTURE',
                    'PAID_PARTIALLY_FLAGGED','STATUS_TEXT_UNKNOWN','LINE_AMOUNT_MISMATCH','DISCOUNT_OUT_OF_RANGE',
                    'AMOUNT_ROUNDED','CREDIT_NOTE_UNLINKED','CREDIT_NOTE_INCONSISTENT','ZERO_TOTAL','NO_CHILD',
                    'FAMILY_NOT_IN_REGISTER','CHILD_NOT_IN_REGISTER','CHILD_IN_TWO_FAMILIES','LINES_DISAGREE',
                    'EMPTY_BLOCK_ABSORBED','NEGATIVE_LINE','ITEM_UNRECOGNISED','NUMBER_GAPS','B_SERIES')),
  severity        TEXT NOT NULL CHECK (severity IN ('ISOLATE', 'REVIEW', 'INFO')),
  entity          TEXT NOT NULL DEFAULT '',
  number          TEXT NOT NULL DEFAULT '',
  -- the imported invoice the finding is about; NULL for isolated records and register findings
  invoice_id      TEXT REFERENCES invoices(id) ON DELETE RESTRICT,
  excel_rows      TEXT NOT NULL DEFAULT '',
  reason          TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  amount          INTEGER,
  first_seen_at   TEXT NOT NULL,
  last_seen_at    TEXT NOT NULL,
  last_seen_file  TEXT NOT NULL,
  resolved_at     TEXT,
  resolution_note TEXT NOT NULL DEFAULT '',
  CHECK (resolved_at IS NULL OR length(trim(resolution_note)) > 0)
);

CREATE INDEX idx_import_findings_open ON legacy_import_findings(resolved_at, severity);
CREATE INDEX idx_import_findings_invoice ON legacy_import_findings(invoice_id);
