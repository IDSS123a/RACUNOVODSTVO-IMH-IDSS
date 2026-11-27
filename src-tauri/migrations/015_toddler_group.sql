-- 015: the IMH kindergarten records its group again (Director, 2026-11-27; SPEC registration-validation A9).
-- Until now a new enrolment was always stored as PRESCHOOLERS (one choice „Toddlers / Preschoolers“, DL-P014
-- amendment 2). Preschoolers start at the 2nd birthday, so an enrolment of a child younger than 2 on its first day
-- becomes TODDLERS. Nothing else changes: every other enrolment keeps its group (the operator may change it), the
-- price is the same, and issued invoices keep their lines.
-- Rollback: restore the backup taken before the update.
UPDATE enrolments
   SET program = 'TODDLERS'
 WHERE program = 'PRESCHOOLERS'
   AND child_id IN (SELECT c.id FROM children c
                     WHERE c.date_of_birth IS NOT NULL
                       AND c.date_of_birth > date(enrolments.starts_on, '-2 years'));
