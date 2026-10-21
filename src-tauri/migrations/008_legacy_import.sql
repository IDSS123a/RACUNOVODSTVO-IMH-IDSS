-- 008: import from the previous Excel solution (BR-32, Director 2026-10-21).
-- Runs with foreign keys OFF (see migrations.rs) and is checked with PRAGMA foreign_key_check
-- before commit. Tables are rebuilt because SQLite cannot relax NOT NULL / CHECK in place.

-- Families and children carry the key they were imported under, so a re-import never duplicates them.
ALTER TABLE families ADD COLUMN legacy_key TEXT;
CREATE UNIQUE INDEX ux_families_legacy_key ON families(legacy_key) WHERE legacy_key IS NOT NULL;

-- Children: date of birth may be unknown after the import; import_review = data the operator must check.
CREATE TABLE children_new (
  id            TEXT PRIMARY KEY,
  family_id     TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  date_of_birth TEXT CHECK (date_of_birth IS NULL OR date_of_birth GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  residency     TEXT NOT NULL CHECK (residency IN ('DOMESTIC','FOREIGN')),
  created_at    TEXT NOT NULL,
  citizen_bih   INTEGER NOT NULL DEFAULT 1 CHECK (citizen_bih IN (0, 1)),
  residence_ks  INTEGER NOT NULL DEFAULT 1 CHECK (residence_ks IN (0, 1)),
  import_review INTEGER NOT NULL DEFAULT 0 CHECK (import_review IN (0, 1)),
  legacy_key    TEXT
);
INSERT INTO children_new(id, family_id, first_name, last_name, date_of_birth, residency, created_at, citizen_bih, residence_ks)
  SELECT id, family_id, first_name, last_name, date_of_birth, residency, created_at, citizen_bih, residence_ks FROM children;
DROP TABLE children;
ALTER TABLE children_new RENAME TO children;
CREATE INDEX idx_children_family ON children(family_id);
CREATE UNIQUE INDEX ux_children_legacy_key ON children(legacy_key) WHERE legacy_key IS NOT NULL;

-- Invoices: imported ones keep their original number and amounts (credit notes are negative).
CREATE TABLE invoices_new (
  id            TEXT PRIMARY KEY,
  number        TEXT NOT NULL UNIQUE,
  entity        TEXT NOT NULL CHECK (entity IN ('IMH', 'IDSS')),
  kind          TEXT NOT NULL CHECK (kind IN ('MONTHLY', 'ENROLMENT_FEES', 'INSTALMENT', 'OTHER', 'CREDIT_NOTE')),
  family_id     TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  buyer_name    TEXT NOT NULL,
  buyer_address TEXT NOT NULL DEFAULT '',
  issue_date    TEXT NOT NULL,
  due_date      TEXT NOT NULL,
  period_from   TEXT NOT NULL,
  period_to     TEXT NOT NULL,
  total_fenings INTEGER NOT NULL,
  status        TEXT NOT NULL CHECK (status IN ('ISSUED', 'CANCELLED')),
  created_at    TEXT NOT NULL,
  child_id      TEXT REFERENCES children(id) ON DELETE RESTRICT,
  source        TEXT NOT NULL DEFAULT 'APP' CHECK (source IN ('APP', 'LEGACY')),
  CHECK (source = 'LEGACY' OR total_fenings >= 0),
  CHECK (source = 'LEGACY' OR due_date >= issue_date),
  CHECK (source = 'LEGACY' OR period_to >= period_from)
);
INSERT INTO invoices_new(id, number, entity, kind, family_id, buyer_name, buyer_address, issue_date, due_date,
                         period_from, period_to, total_fenings, status, created_at, child_id)
  SELECT id, number, entity, kind, family_id, buyer_name, buyer_address, issue_date, due_date,
         period_from, period_to, total_fenings, status, created_at, child_id FROM invoices;
DROP TABLE invoices;
ALTER TABLE invoices_new RENAME TO invoices;
CREATE INDEX idx_invoices_family ON invoices(family_id);
CREATE INDEX idx_invoices_issue ON invoices(entity, issue_date);
CREATE INDEX idx_invoices_child ON invoices(child_id);
CREATE UNIQUE INDEX ux_invoices_monthly_child ON invoices(child_id, entity, period_from)
  WHERE kind = 'MONTHLY' AND status = 'ISSUED';
CREATE UNIQUE INDEX ux_invoices_enrolment_fees ON invoices(child_id, entity, period_from)
  WHERE kind = 'ENROLMENT_FEES' AND status = 'ISSUED';

-- Invoice lines: imported lines have no enrolment/program; credit-note lines are negative.
CREATE TABLE invoice_lines_new (
  id                TEXT PRIMARY KEY,
  invoice_id        TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  position          INTEGER NOT NULL CHECK (position >= 1),
  item_code         TEXT NOT NULL,
  description       TEXT NOT NULL,
  child_id          TEXT REFERENCES children(id) ON DELETE RESTRICT,
  enrolment_id      TEXT REFERENCES enrolments(id) ON DELETE RESTRICT,
  program           TEXT,
  list_amount       INTEGER NOT NULL,
  board_decision_id TEXT,
  amount            INTEGER NOT NULL,
  UNIQUE (invoice_id, position)
);
INSERT INTO invoice_lines_new SELECT id, invoice_id, position, item_code, description, child_id, enrolment_id, program,
                                     list_amount, board_decision_id, amount FROM invoice_lines;
DROP TABLE invoice_lines;
ALTER TABLE invoice_lines_new RENAME TO invoice_lines;
