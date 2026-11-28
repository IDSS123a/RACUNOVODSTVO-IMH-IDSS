import { describe, expect, it } from 'vitest';
import { childInvoices, openSummary } from './family-invoices';
import type { InvoiceSummary } from './repository';

function invoice(over: Partial<InvoiceSummary>): InvoiceSummary {
  return {
    id: 'i', number: 'IDSS-001/26', entity: 'IDSS', kind: 'INSTALMENT', familyId: 'f', familyName: 'Begović', childId: 'c', childName: 'Amir Begović',
    source: 'APP', buyerName: 'Amra Begović', buyerAddress: '', issueDate: '2026-11-01', dueDate: '2026-11-05', periodFrom: '2026-11-01',
    periodTo: '2026-11-30', total: 50000, paid: 0, status: 'ISSUED', credited: 0, creditsInvoiceId: null, reason: '',
    ...over,
  };
}

describe('a child’s invoices on the family card (Director, 2026-11-28)', () => {
  const all = [
    invoice({ id: 'a', number: 'IDSS-001/26', issueDate: '2026-11-01' }),
    invoice({ id: 'b', number: 'IDSS-002/26', issueDate: '2026-11-20', total: 222000, credited: -222000, status: 'CANCELLED' }),
    invoice({ id: 'ko', number: 'IDSS-KO-036/26', kind: 'CREDIT_NOTE', total: -222000, creditsInvoiceId: 'b', issueDate: '2026-11-21' }),
    invoice({ id: 'p', number: 'IDSS-003/26', issueDate: '2026-11-10', paid: 50000 }),
    invoice({ id: 'x', number: 'IDSS-004/26', childId: 'other' }),
    invoice({ id: 'y', number: 'IMH-001/26', entity: 'IMH' }),
    invoice({ id: 'z', number: 'IDSS-005/26', familyId: 'g' }),
  ];

  it('only this family, institution and child; newest first; the credit note under its invoice', () => {
    const rows = childInvoices(all, 'f', 'IDSS', 'c');
    expect(rows.map((r) => r.invoice.number)).toEqual(['IDSS-002/26', 'IDSS-003/26', 'IDSS-001/26']);
    expect(rows[0]?.creditNotes.map((c) => c.number)).toEqual(['IDSS-KO-036/26']);
    expect(rows[0]?.balance.status).toBe('CANCELLED');
  });

  it('counts the open invoices and what is left to pay; a cancelled or paid one is not open', () => {
    expect(openSummary(childInvoices(all, 'f', 'IDSS', 'c'))).toEqual({ count: 3, open: 1, openAmount: 50000 });
  });

  it('invoices without a child are found under „Računi bez djeteta“', () => {
    expect(childInvoices([invoice({ childId: '' })], 'f', 'IDSS', null)).toHaveLength(1);
  });
});
