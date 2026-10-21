-- 004: one invoice per child (BR-27).
-- Migration 003 is applied and never edited; this adds the child to the invoice header
-- and replaces the per-family double-billing guard with a per-child guard.

ALTER TABLE invoices ADD COLUMN child_id TEXT REFERENCES children(id) ON DELETE RESTRICT;

-- Back-fill invoices issued before this migration from their first line.
UPDATE invoices
   SET child_id = (SELECT l.child_id FROM invoice_lines l WHERE l.invoice_id = invoices.id ORDER BY l.position LIMIT 1)
 WHERE child_id IS NULL;

DROP INDEX ux_invoices_monthly;

-- One monthly invoice per child, entity and month (prevents double billing).
CREATE UNIQUE INDEX ux_invoices_monthly_child ON invoices(child_id, entity, period_from)
  WHERE kind = 'MONTHLY' AND status = 'ISSUED';
CREATE INDEX idx_invoices_child ON invoices(child_id);
