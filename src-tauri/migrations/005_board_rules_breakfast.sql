-- 005: billing parameters decided by the board per school year (Director, 2026-10-21),
-- and the breakfast opt-in per enrolment (BR-11).

CREATE TABLE board_billing_rules (
  school_year        TEXT NOT NULL CHECK (school_year GLOB '[0-9][0-9][0-9][0-9]/[0-9][0-9][0-9][0-9]'),
  entity             TEXT NOT NULL CHECK (entity IN ('IMH', 'IDSS')),
  -- Latest due date of a payment plan's last instalment; NULL = not decided (no limit enforced).
  last_instalment_by TEXT CHECK (last_instalment_by IS NULL OR last_instalment_by GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  -- Calendar months (1–12, comma-separated) in which breakfast is billed; '' = not decided.
  breakfast_months   TEXT NOT NULL DEFAULT '',
  -- Board decision number and date, e.g. "ŠO 7/2026 od 19.02.2026".
  decision_ref       TEXT NOT NULL CHECK (length(trim(decision_ref)) > 0),
  updated_at         TEXT NOT NULL,
  PRIMARY KEY (school_year, entity)
);

CREATE TABLE enrolment_breakfast (
  enrolment_id TEXT PRIMARY KEY REFERENCES enrolments(id) ON DELETE CASCADE,
  created_at   TEXT NOT NULL
);
