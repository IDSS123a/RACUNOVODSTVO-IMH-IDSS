-- 013: quantity and unit of measure per invoice line (specs/manual-invoice, F2; document `vNew`: Naziv, JM, Količina, Cijena).
-- A manual invoice line is quantity × unit price; every earlier line keeps quantity 1, and its unit stays NULL so it is
-- derived from the item code as before (F1 / SPEC C5). Nothing is recalculated.
-- Rollback: not needed (additive columns); restore the backup taken before the update if ever required.
ALTER TABLE invoice_lines ADD COLUMN quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 999);
ALTER TABLE invoice_lines ADD COLUMN unit TEXT CHECK (unit IS NULL OR unit IN ('kom', 'srv'));
