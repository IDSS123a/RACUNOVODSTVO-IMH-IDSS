-- Migration: 002_families
-- Date: 2026-10-21
-- Author: ACA (Claude Code)
-- Description: Guardians (payer + IBAN for subsidy refunds), family address, child
--              subsidy-eligibility facts, and a uniqueness rule: one active enrolment
--              per child, legal entity and school year (BR-1, BR-6).
-- Rollback: DROP INDEX ux_enrolments_active; DROP INDEX ux_guardians_one_payer;
--           DROP TABLE guardians; (SQLite ≥ 3.35: ALTER TABLE ... DROP COLUMN for the added columns)

ALTER TABLE families ADD COLUMN address TEXT NOT NULL DEFAULT '';

ALTER TABLE children ADD COLUMN citizen_bih INTEGER NOT NULL DEFAULT 1 CHECK (citizen_bih IN (0, 1));
ALTER TABLE children ADD COLUMN residence_ks INTEGER NOT NULL DEFAULT 1 CHECK (residence_ks IN (0, 1));

CREATE TABLE guardians (
  id         TEXT PRIMARY KEY,
  family_id  TEXT NOT NULL REFERENCES families(id) ON DELETE RESTRICT,
  full_name  TEXT NOT NULL,
  role       TEXT NOT NULL CHECK (role IN ('MOTHER', 'FATHER', 'GUARDIAN')),
  email      TEXT NOT NULL DEFAULT '',
  phone      TEXT NOT NULL DEFAULT '',
  iban       TEXT NOT NULL DEFAULT '',
  is_payer   INTEGER NOT NULL DEFAULT 0 CHECK (is_payer IN (0, 1)),
  created_at TEXT NOT NULL
);

CREATE INDEX idx_guardians_family ON guardians(family_id);

-- At most one payer per family (exactly one is enforced in the domain layer).
CREATE UNIQUE INDEX ux_guardians_one_payer ON guardians(family_id) WHERE is_payer = 1;

-- Legal entity derived from the program. WHY duplicated here: a database-level guard against
-- double billing. The authoritative mapping is PROGRAM_ENTITY in src/features/price-lists/types.ts.
ALTER TABLE enrolments ADD COLUMN entity TEXT GENERATED ALWAYS AS (
  CASE WHEN program IN ('PRIMARY_1_4', 'PRIMARY_5_9') THEN 'IDSS' ELSE 'IMH' END
) VIRTUAL;

CREATE UNIQUE INDEX ux_enrolments_active ON enrolments(child_id, entity, school_year)
  WHERE status IN ('AWAITING_ENROLMENT_PAYMENT', 'ACTIVE', 'WITHDRAWAL_NOTIFIED', 'SUSPENDED');
