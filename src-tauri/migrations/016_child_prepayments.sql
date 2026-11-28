-- Migration 016 — Child prepayment (specs/family-advance, Director 2026-11-28, Q1–Q6, BR-24 amended).
-- Append-only: a payment without an invoice, its use on an invoice or a refund, and the reversal of either are
-- separate records. Nothing is updated or deleted. Existing data needs no change: an excess already on an invoice
-- (paid above the net) is by definition a prepayment of the invoice's child (Q4).

-- 1. Who paid, as relation to the child (Q6: typed each time; '' = not recorded on older payments).
ALTER TABLE payments ADD COLUMN payer_relation TEXT NOT NULL DEFAULT '';

-- 2. A payment without an invoice, for one child of the family in one institution (Q1).
CREATE TABLE prepayments (
  id             TEXT PRIMARY KEY,
  family_id      TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  entity         TEXT NOT NULL CHECK (entity IN ('IMH', 'IDSS')),
  child_id       TEXT NOT NULL REFERENCES children(id) ON DELETE RESTRICT,
  paid_on        TEXT NOT NULL CHECK (paid_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  amount         INTEGER NOT NULL CHECK (amount > 0),
  payer_name     TEXT NOT NULL CHECK (length(trim(payer_name)) > 0),
  payer_relation TEXT NOT NULL CHECK (length(trim(payer_relation)) > 0),
  reference      TEXT NOT NULL DEFAULT '',
  note           TEXT NOT NULL DEFAULT '',
  created_at     TEXT NOT NULL
);
CREATE INDEX idx_prepayments_family ON prepayments(family_id, entity, child_id);

CREATE TRIGGER prepayments_child_of_family BEFORE INSERT ON prepayments
WHEN NOT EXISTS (SELECT 1 FROM children WHERE id = NEW.child_id AND family_id = NEW.family_id)
BEGIN
  SELECT RAISE(ABORT, 'dijete nije iz te porodice');
END;

CREATE TABLE prepayment_reversals (
  id            TEXT PRIMARY KEY,
  prepayment_id TEXT NOT NULL UNIQUE REFERENCES prepayments(id) ON DELETE RESTRICT,
  reversed_on   TEXT NOT NULL CHECK (reversed_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  reason        TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  created_at    TEXT NOT NULL
);

-- 3. A use of prepaid money. Its source is a prepayment OR the excess on an invoice (Q4), exactly one of them.
--    The target is an invoice of the same family and institution, or nothing (= refund to the payer).
CREATE TABLE prepayment_uses (
  id                TEXT PRIMARY KEY,
  prepayment_id     TEXT REFERENCES prepayments(id) ON DELETE RESTRICT,
  source_invoice_id TEXT REFERENCES invoices(id) ON DELETE RESTRICT,
  invoice_id        TEXT REFERENCES invoices(id) ON DELETE RESTRICT,
  amount            INTEGER NOT NULL CHECK (amount > 0),
  used_on           TEXT NOT NULL CHECK (used_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  note              TEXT NOT NULL CHECK (length(trim(note)) > 0),
  created_at        TEXT NOT NULL,
  CHECK ((prepayment_id IS NULL) <> (source_invoice_id IS NULL)),
  CHECK (invoice_id IS NULL OR source_invoice_id IS NULL OR invoice_id <> source_invoice_id)
);
CREATE INDEX idx_prepayment_uses_prepayment ON prepayment_uses(prepayment_id);
CREATE INDEX idx_prepayment_uses_source ON prepayment_uses(source_invoice_id);
CREATE INDEX idx_prepayment_uses_invoice ON prepayment_uses(invoice_id);

CREATE TABLE prepayment_use_reversals (
  id          TEXT PRIMARY KEY,
  use_id      TEXT NOT NULL UNIQUE REFERENCES prepayment_uses(id) ON DELETE RESTRICT,
  reversed_on TEXT NOT NULL CHECK (reversed_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  reason      TEXT NOT NULL CHECK (length(trim(reason)) > 0),
  created_at  TEXT NOT NULL
);

-- 4. Append-only, also against a direct write to the database.
CREATE TRIGGER prepayments_no_update BEFORE UPDATE ON prepayments BEGIN SELECT RAISE(ABORT, 'pretplata se ne mijenja — stornira se'); END;
CREATE TRIGGER prepayments_no_delete BEFORE DELETE ON prepayments BEGIN SELECT RAISE(ABORT, 'pretplata se ne briše — stornira se'); END;
CREATE TRIGGER prepayment_uses_no_update BEFORE UPDATE ON prepayment_uses BEGIN SELECT RAISE(ABORT, 'primjena pretplate se ne mijenja — stornira se'); END;
CREATE TRIGGER prepayment_uses_no_delete BEFORE DELETE ON prepayment_uses BEGIN SELECT RAISE(ABORT, 'primjena pretplate se ne briše — stornira se'); END;
CREATE TRIGGER prepayment_reversals_no_change BEFORE UPDATE ON prepayment_reversals BEGIN SELECT RAISE(ABORT, 'storno se ne mijenja'); END;
CREATE TRIGGER prepayment_reversals_no_delete BEFORE DELETE ON prepayment_reversals BEGIN SELECT RAISE(ABORT, 'storno se ne briše'); END;
CREATE TRIGGER prepayment_use_reversals_no_change BEFORE UPDATE ON prepayment_use_reversals BEGIN SELECT RAISE(ABORT, 'storno se ne mijenja'); END;
CREATE TRIGGER prepayment_use_reversals_no_delete BEFORE DELETE ON prepayment_use_reversals BEGIN SELECT RAISE(ABORT, 'storno se ne briše'); END;
