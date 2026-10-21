-- 006: free-text note printed on every invoice of an institution (e.g. the PDV / tax-exemption statement).
-- It is a legal statement entered by the operator in Settings; there is no default text (M-4).
ALTER TABLE legal_entities ADD COLUMN invoice_note TEXT NOT NULL DEFAULT '';
