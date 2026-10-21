-- Migration: 003_invoices
-- Date: 2026-10-21
-- Author: ACA (Claude Code)
-- Description: Invoices with gap-free numbering per legal entity and year (BR-23), invoice lines,
--              payments from any family member (BR-24), IDSS payment plans (BR-11).
-- Rollback: DROP TABLE payment_plan_items; DROP TABLE payment_plans; DROP TABLE payments;
--           DROP TABLE invoice_lines; DROP TABLE invoices; DROP TABLE invoice_sequences;

-- Last issued sequence number per entity and year. Incremented inside the issuing transaction.
CREATE TABLE invoice_sequences (
  entity      TEXT NOT NULL CHECK (entity IN ('IMH', 'IDSS')),
  year        INTEGER NOT NULL CHECK (year BETWEEN 2000 AND 2999),
  last_number INTEGER NOT NULL CHECK (last_number >= 0),
  PRIMARY KEY (entity, year)
);

CREATE TABLE invoices (
  id            TEXT PRIMARY KEY,
  number        TEXT NOT NULL UNIQUE,
  entity        TEXT NOT NULL CHECK (entity IN ('IMH', 'IDSS')),
  kind          TEXT NOT NULL CHECK (kind IN ('MONTHLY', 'ENROLMENT_FEES', 'INSTALMENT', 'OTHER')),
  family_id     TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  buyer_name    TEXT NOT NULL,
  buyer_address TEXT NOT NULL DEFAULT '',
  issue_date    TEXT NOT NULL,
  due_date      TEXT NOT NULL,
  period_from   TEXT NOT NULL,
  period_to     TEXT NOT NULL,
  total_fenings INTEGER NOT NULL CHECK (total_fenings >= 0),
  status        TEXT NOT NULL CHECK (status IN ('ISSUED', 'CANCELLED')),
  created_at    TEXT NOT NULL,
  CHECK (due_date >= issue_date),
  CHECK (period_to >= period_from)
);

-- One monthly invoice per family, entity and month (prevents double billing).
CREATE UNIQUE INDEX ux_invoices_monthly ON invoices(family_id, entity, period_from)
  WHERE kind = 'MONTHLY' AND status = 'ISSUED';
CREATE INDEX idx_invoices_family ON invoices(family_id);
CREATE INDEX idx_invoices_issue ON invoices(entity, issue_date);

CREATE TABLE invoice_lines (
  id                TEXT PRIMARY KEY,
  invoice_id        TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  position          INTEGER NOT NULL CHECK (position >= 1),
  item_code         TEXT NOT NULL,
  description       TEXT NOT NULL,
  child_id          TEXT NOT NULL REFERENCES children(id) ON DELETE RESTRICT,
  enrolment_id      TEXT NOT NULL REFERENCES enrolments(id) ON DELETE RESTRICT,
  program           TEXT NOT NULL,
  list_amount       INTEGER NOT NULL CHECK (list_amount >= 0),
  board_decision_id TEXT,
  amount            INTEGER NOT NULL CHECK (amount >= 0),
  UNIQUE (invoice_id, position)
);

-- Payments: any family member may pay; the payer's name is recorded as given (BR-24).
CREATE TABLE payments (
  id            TEXT PRIMARY KEY,
  invoice_id    TEXT NOT NULL REFERENCES invoices(id) ON DELETE RESTRICT,
  paid_on       TEXT NOT NULL,
  amount        INTEGER NOT NULL CHECK (amount > 0),
  payer_name    TEXT NOT NULL,
  reference     TEXT NOT NULL DEFAULT '',
  note          TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL
);
CREATE INDEX idx_payments_invoice ON payments(invoice_id);

-- IDSS payment plans per enrolment and item (tuition, extended stay).
CREATE TABLE payment_plans (
  id           TEXT PRIMARY KEY,
  enrolment_id TEXT NOT NULL REFERENCES enrolments(id) ON DELETE RESTRICT,
  item_code    TEXT NOT NULL CHECK (item_code IN ('TUITION', 'EXTENDED_STAY')),
  instalments  INTEGER NOT NULL CHECK (instalments BETWEEN 1 AND 12),
  total        INTEGER NOT NULL CHECK (total >= 0),
  created_at   TEXT NOT NULL,
  UNIQUE (enrolment_id, item_code)
);

CREATE TABLE payment_plan_items (
  plan_id    TEXT NOT NULL REFERENCES payment_plans(id) ON DELETE RESTRICT,
  sequence   INTEGER NOT NULL CHECK (sequence BETWEEN 1 AND 12),
  due_date   TEXT NOT NULL,
  amount     INTEGER NOT NULL CHECK (amount >= 0),
  invoice_id TEXT REFERENCES invoices(id) ON DELETE RESTRICT,
  PRIMARY KEY (plan_id, sequence)
);
