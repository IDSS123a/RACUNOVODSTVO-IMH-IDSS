-- 007: at most one enrolment-fee invoice per child, entity and school year (BR-9, BR-10).
-- period_from of an ENROLMENT_FEES invoice is the first day of the school year.
CREATE UNIQUE INDEX ux_invoices_enrolment_fees ON invoices(child_id, entity, period_from)
  WHERE kind = 'ENROLMENT_FEES' AND status = 'ISSUED';
