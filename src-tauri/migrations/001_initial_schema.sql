-- Migration: 001_initial_schema
-- Date: 2026-10-21
-- Author: ACA (Claude Code)
-- Description: Core schema — legal entities, price lists, ministry approvals, families,
--              children, enrolments, board decisions, settings, audit log (Sprint 01).
--              Invoices, payments and the subsidy cycle follow in later migrations.
-- Rollback: DROP TABLE audit_log; DROP TABLE settings; DROP TABLE board_decisions;
--           DROP TABLE enrolments; DROP TABLE children; DROP TABLE families;
--           DROP TABLE ministry_approvals; DROP TABLE price_list_items; DROP TABLE legal_entities;

PRAGMA foreign_keys = ON;

-- Institution master data from the official letterheads (BR-2).
CREATE TABLE legal_entities (
  code                TEXT PRIMARY KEY CHECK (code IN ('IMH', 'IDSS')),
  full_name           TEXT NOT NULL,
  short_name          TEXT NOT NULL,
  address             TEXT NOT NULL,
  phone               TEXT NOT NULL DEFAULT '',
  fax                 TEXT NOT NULL DEFAULT '',
  mobile              TEXT NOT NULL DEFAULT '',
  email               TEXT NOT NULL DEFAULT '',
  website             TEXT NOT NULL DEFAULT '',
  tax_id              TEXT NOT NULL,
  registration_number TEXT NOT NULL,
  bank_name           TEXT NOT NULL,
  bank_account        TEXT NOT NULL,
  iban                TEXT NOT NULL,
  swift               TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

-- Official price lists, versioned per school year (DL-P005). Amounts in fenings (DL-P003).
CREATE TABLE price_list_items (
  id             INTEGER PRIMARY KEY,
  school_year    TEXT NOT NULL CHECK (school_year GLOB '[0-9][0-9][0-9][0-9]/[0-9][0-9][0-9][0-9]'),
  program        TEXT NOT NULL CHECK (program IN ('TODDLERS','PRESCHOOLERS','IDSS_PRESCHOOLERS','PRIMARY_1_4','PRIMARY_5_9')),
  item           TEXT NOT NULL CHECK (item IN ('ENROLMENT_FEE','ENROLMENT_FEE_AFTER_IDSS_PRESCHOOL','MATERIALS','DEPOSIT','TUITION','EXTENDED_STAY','BREAKFAST')),
  residency      TEXT NOT NULL CHECK (residency IN ('DOMESTIC','FOREIGN')),
  tier           TEXT NOT NULL CHECK (tier IN ('ANY','FIRST','SUBSEQUENT','SECOND','THIRD_PLUS')),
  basis          TEXT NOT NULL CHECK (basis IN ('ONE_TIME','MONTHLY','ANNUAL')),
  amount_fenings INTEGER NOT NULL CHECK (amount_fenings >= 0),
  source         TEXT NOT NULL,
  UNIQUE (school_year, program, item, residency, tier)
);

-- Written ministry approvals for price increases (D16, BR-20).
CREATE TABLE ministry_approvals (
  school_year     TEXT PRIMARY KEY,
  document_number TEXT NOT NULL,
  document_date   TEXT NOT NULL,
  note            TEXT NOT NULL DEFAULT '',
  recorded_at     TEXT NOT NULL
);

CREATE TABLE families (
  id           TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE TABLE children (
  id            TEXT PRIMARY KEY,
  family_id     TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  date_of_birth TEXT NOT NULL,
  residency     TEXT NOT NULL CHECK (residency IN ('DOMESTIC','FOREIGN')),
  created_at    TEXT NOT NULL
);

-- Child × program × school year. Program determines the legal entity (BR-1).
CREATE TABLE enrolments (
  id          TEXT PRIMARY KEY,
  child_id    TEXT NOT NULL REFERENCES children(id) ON DELETE RESTRICT,
  program     TEXT NOT NULL CHECK (program IN ('TODDLERS','PRESCHOOLERS','IDSS_PRESCHOOLERS','PRIMARY_1_4','PRIMARY_5_9')),
  school_year TEXT NOT NULL,
  starts_on   TEXT NOT NULL,
  ends_on     TEXT,
  status      TEXT NOT NULL CHECK (status IN ('AWAITING_ENROLMENT_PAYMENT','ACTIVE','WITHDRAWAL_NOTIFIED','WITHDRAWN','SUSPENDED','COMPLETED')),
  created_at  TEXT NOT NULL
);

-- Board decisions — the only way to reduce an amount besides the price-list sibling tier (BR-7).
CREATE TABLE board_decisions (
  id              TEXT PRIMARY KEY,
  body            TEXT NOT NULL CHECK (body IN ('UO_IMH','SO_IDSS')),
  number          TEXT NOT NULL,
  decided_on      TEXT NOT NULL,
  child_id        TEXT NOT NULL REFERENCES children(id) ON DELETE RESTRICT,
  item            TEXT NOT NULL,
  effect_kind     TEXT NOT NULL CHECK (effect_kind IN ('DISCOUNT','FIXED_AMOUNT')),
  discount_bp     INTEGER CHECK (discount_bp BETWEEN 0 AND 10000),
  amount_fenings  INTEGER CHECK (amount_fenings >= 0),
  valid_from      TEXT NOT NULL,
  valid_to        TEXT NOT NULL,
  note            TEXT NOT NULL DEFAULT '',
  created_at      TEXT NOT NULL,
  CHECK ((effect_kind = 'DISCOUNT' AND discount_bp IS NOT NULL) OR (effect_kind = 'FIXED_AMOUNT' AND amount_fenings IS NOT NULL))
);

CREATE TABLE settings (
  key        TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Audit trail for every write (E-5). Lives inside the encrypted database.
CREATE TABLE audit_log (
  id         INTEGER PRIMARY KEY,
  at         TEXT NOT NULL,
  action     TEXT NOT NULL,
  entity     TEXT NOT NULL,
  entity_id  TEXT NOT NULL DEFAULT '',
  details    TEXT NOT NULL DEFAULT ''
);

CREATE INDEX idx_children_family ON children(family_id);
CREATE INDEX idx_enrolments_child ON enrolments(child_id);
CREATE INDEX idx_price_items_year ON price_list_items(school_year);
