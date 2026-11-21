-- 012: default PDV exemption sentence of P.P.U. IMH on invoices (specs/invoice-pdf-complete, SPEC C6).
-- The text is the constant NOTE of the institutions' document IMH-IDSS-Fakturisanje.html, the same as
-- IMH_PDV_NOTE in src/constants (fresh databases get it from the seed). Set only while the IMH note is still
-- empty: a note entered by the operator in Settings is never overwritten. IDSS stays as it is (open for the
-- accountant: IDSS is a P.U., not a PPU).
-- Rollback: UPDATE legal_entities SET invoice_note = '' WHERE code = 'IMH' AND invoice_note = <the text below>;
UPDATE legal_entities
   SET invoice_note = 'PPU nije obveznik PDV-a, u skladu sa članom 24. stav 1. tačka 4. Zakona o PDV.'
 WHERE code = 'IMH' AND trim(invoice_note) = '';
