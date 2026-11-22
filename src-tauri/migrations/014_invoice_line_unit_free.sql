-- 014: the unit of measure of an invoice line is no longer only „kom“ or „srv“. The usual units are proposed, and the
-- operator may type any other short unit, e.g. „sedm.“ for a week of summer school (Director, 2026-11-22: „za svako
-- polje mora postojati šablon ali i mogućnost da se drugačije unese“).
-- SQLite cannot change a CHECK, so the table is rebuilt as in 008: same columns, same order, every row copied unchanged.
-- The application checks the unit (letters and dots, up to 10 characters); the database keeps a coarse guard.
-- Rollback: restore the backup taken before the update (the new check accepts every value the old one did).
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
  credits_position  INTEGER CHECK (credits_position IS NULL OR credits_position >= 1),
  quantity          INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 999),
  unit              TEXT CHECK (unit IS NULL OR (length(unit) BETWEEN 1 AND 10 AND unit = trim(unit) AND unit NOT GLOB '*[0-9]*')),
  UNIQUE (invoice_id, position)
);
INSERT INTO invoice_lines_new (id, invoice_id, position, item_code, description, child_id, enrolment_id, program,
                               list_amount, board_decision_id, amount, credits_position, quantity, unit)
  SELECT id, invoice_id, position, item_code, description, child_id, enrolment_id, program,
         list_amount, board_decision_id, amount, credits_position, quantity, unit FROM invoice_lines;
DROP TABLE invoice_lines;
ALTER TABLE invoice_lines_new RENAME TO invoice_lines;
