-- 010: storno, credit notes and payment correction (specs/storno-credit-notes, Director S1–S6, 2026-11-21).
-- Runs with foreign keys OFF (migrations.rs) and must leave PRAGMA foreign_key_check empty.
-- `invoices` is rebuilt (SQLite cannot change a CHECK in place), like 008. Nothing is ever deleted:
-- credit notes, payment reversals and credit movements are appended records.
-- Rollback: not supported in place (restore the backup taken before the update).

-- 1. invoices: credit notes issued in the app are negative, point to the invoice they cancel, and carry a reason.
CREATE TABLE invoices_new (
  id                 TEXT PRIMARY KEY,
  number             TEXT NOT NULL UNIQUE,
  entity             TEXT NOT NULL CHECK (entity IN ('IMH', 'IDSS')),
  kind               TEXT NOT NULL CHECK (kind IN ('MONTHLY', 'ENROLMENT_FEES', 'INSTALMENT', 'OTHER', 'CREDIT_NOTE')),
  family_id          TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  buyer_name         TEXT NOT NULL,
  buyer_address      TEXT NOT NULL DEFAULT '',
  issue_date         TEXT NOT NULL,
  due_date           TEXT NOT NULL,
  period_from        TEXT NOT NULL,
  period_to          TEXT NOT NULL,
  total_fenings      INTEGER NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('ISSUED', 'CANCELLED')),
  created_at         TEXT NOT NULL,
  child_id           TEXT REFERENCES children(id) ON DELETE RESTRICT,
  source             TEXT NOT NULL DEFAULT 'APP' CHECK (source IN ('APP', 'LEGACY')),
  credits_invoice_id TEXT REFERENCES invoices(id) ON DELETE RESTRICT,
  reason             TEXT NOT NULL DEFAULT '',
  CHECK (source = 'LEGACY' OR kind = 'CREDIT_NOTE' OR total_fenings >= 0),
  CHECK (source = 'LEGACY' OR due_date >= issue_date),
  CHECK (source = 'LEGACY' OR period_to >= period_from),
  CHECK (kind <> 'CREDIT_NOTE' OR total_fenings < 0),
  CHECK (source = 'LEGACY' OR kind <> 'CREDIT_NOTE' OR (credits_invoice_id IS NOT NULL AND length(trim(reason)) > 0)),
  CHECK (kind = 'CREDIT_NOTE' OR credits_invoice_id IS NULL),
  CHECK (credits_invoice_id IS NULL OR credits_invoice_id <> id)
);
INSERT INTO invoices_new(id, number, entity, kind, family_id, buyer_name, buyer_address, issue_date, due_date,
                         period_from, period_to, total_fenings, status, created_at, child_id, source)
  SELECT id, number, entity, kind, family_id, buyer_name, buyer_address, issue_date, due_date,
         period_from, period_to, total_fenings, status, created_at, child_id, source FROM invoices;
DROP TABLE invoices;
ALTER TABLE invoices_new RENAME TO invoices;
CREATE INDEX idx_invoices_family ON invoices(family_id);
CREATE INDEX idx_invoices_issue ON invoices(entity, issue_date);
CREATE INDEX idx_invoices_child ON invoices(child_id);
CREATE INDEX idx_invoices_credits ON invoices(credits_invoice_id);
CREATE UNIQUE INDEX ux_invoices_monthly_child ON invoices(child_id, entity, period_from)
  WHERE kind = 'MONTHLY' AND status = 'ISSUED';
CREATE UNIQUE INDEX ux_invoices_enrolment_fees ON invoices(child_id, entity, period_from)
  WHERE kind = 'ENROLMENT_FEES' AND status = 'ISSUED';

-- A credit-note line names the line of the original invoice it credits (position), so the remaining
-- creditable amount of every original line is known (S2: never more than the invoice).
ALTER TABLE invoice_lines ADD COLUMN credits_position INTEGER CHECK (credits_position IS NULL OR credits_position >= 1);

-- 2. Credit-note numbering (S1): own series per entity and calendar year, e.g. IDSS-KO-036/26.
CREATE TABLE credit_note_sequences (
  entity      TEXT NOT NULL CHECK (entity IN ('IMH', 'IDSS')),
  year        INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2999),
  last_number INTEGER NOT NULL CHECK (last_number >= 0),
  PRIMARY KEY (entity, year)
);
-- Continue after credit notes imported from the old workbook, stored as e.g. 'IDSS KO-35/26'.
INSERT INTO credit_note_sequences(entity, year, last_number)
  SELECT entity, year, max(seq) FROM (
    SELECT entity,
           2000 + CAST(substr(number, -2) AS INTEGER) AS year,
           CAST(substr(number, instr(number, 'KO-') + 3, instr(number, '/') - instr(number, 'KO-') - 3) AS INTEGER) AS seq
    FROM invoices
    WHERE source = 'LEGACY' AND kind = 'CREDIT_NOTE' AND number GLOB '* KO-[0-9]*/[0-9][0-9]'
  )
  GROUP BY entity, year;

-- 3. Payment correction by counter-entry (S4): the payment stays, its reversal makes it not count.
CREATE TABLE payment_reversals (
  id          TEXT PRIMARY KEY,
  payment_id  TEXT NOT NULL UNIQUE REFERENCES payments(id) ON DELETE RESTRICT,
  reversed_on TEXT NOT NULL CHECK (reversed_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  reason      TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  created_at  TEXT NOT NULL
);

-- 4. Family credit (S3): money moved from an invoice with credit to another open invoice of the same
--    family and entity (to_invoice_id) or refunded to the parent (to_invoice_id IS NULL).
CREATE TABLE credit_movements (
  id              TEXT PRIMARY KEY,
  from_invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  to_invoice_id   TEXT REFERENCES invoices(id) ON DELETE RESTRICT,
  amount          INTEGER NOT NULL CHECK (amount > 0),
  moved_on        TEXT NOT NULL CHECK (moved_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  note            TEXT NOT NULL CHECK (length(trim(note)) > 0),
  created_at      TEXT NOT NULL,
  CHECK (to_invoice_id IS NULL OR to_invoice_id <> from_invoice_id)
);
CREATE INDEX idx_credit_movements_from ON credit_movements(from_invoice_id);
CREATE INDEX idx_credit_movements_to ON credit_movements(to_invoice_id);
