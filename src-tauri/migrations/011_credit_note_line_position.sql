-- 011: a credit-note line names the line of the original invoice it credits (specs/storno-credit-notes, S2),
-- so the remaining creditable amount of every original line is known (never more than the invoice).
-- Split out of 010 on 2026-11-21: a trial database had already applied 010 without this column, and an
-- applied migration is never edited (L-S3-11). Fresh databases get it here too.
-- Rollback: not needed (a nullable column).
ALTER TABLE invoice_lines ADD COLUMN credits_position INTEGER CHECK (credits_position IS NULL OR credits_position >= 1);
