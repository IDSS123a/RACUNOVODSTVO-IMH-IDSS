import { describe, expect, it } from 'vitest';
import type { InvoiceSummary } from './repository';
import { fold, matchesQuery, searchInvoices } from './search';

function invoice(over: Partial<InvoiceSummary>): InvoiceSummary {
  return {
    id: 'i', number: 'IMH-012/26', entity: 'IMH', kind: 'MONTHLY', familyId: 'f', familyName: 'Čolić', childId: 'c', childName: 'Đurđa Čolić',
    source: 'APP', buyerName: 'Šejla Čolić-Žižak', buyerAddress: '', issueDate: '2026-11-01', dueDate: '2026-11-05', periodFrom: '2026-11-01',
    periodTo: '2026-11-30', total: 71000, paid: 0, status: 'ISSUED', credited: 0, creditsInvoiceId: null, reason: '',
    ...over,
  };
}

describe('invoice search (Director, 2026-11-21)', () => {
  it('ignores case and Bosnian diacritics', () => {
    expect(fold('Đurđa Čolić-Žižak')).toBe('djurdja colic-zizak');
    for (const q of ['djurdja', 'DURDA', 'đurđa', 'colic', 'zizak', 'sejla', 'Šejla žižak']) {
      expect(matchesQuery(invoice({}), q), q).toBe(true);
    }
    // „đ“ typed as „dj“ or „d“ both find it; a mix of the two does not
    expect(matchesQuery(invoice({}), 'durdja')).toBe(false);
  });

  it('finds the number however it is typed', () => {
    for (const q of ['12/26', '012/26', 'imh 12 26', 'IMH-012/26', 'imh012', 'IMH 12/26']) expect(matchesQuery(invoice({}), q), q).toBe(true);
    expect(matchesQuery(invoice({}), '13/26')).toBe(false);
    expect(matchesQuery(invoice({ number: 'IDSS KO-35/26' }), 'ko 35')).toBe(true);
  });

  it('every word must match; empty query matches all', () => {
    expect(matchesQuery(invoice({}), 'colic 12/26')).toBe(true);
    expect(matchesQuery(invoice({}), 'colic 13/26')).toBe(false);
    expect(matchesQuery(invoice({}), '   ')).toBe(true);
  });

  it('status filters, including overdue and credit notes', () => {
    const list = [
      invoice({ id: 'open' }),
      invoice({ id: 'paid', paid: 71000 }),
      invoice({ id: 'partial', paid: 1000, dueDate: '2026-12-05' }),
      invoice({ id: 'cancelled', credited: -71000, status: 'CANCELLED' }),
      invoice({ id: 'ko', kind: 'CREDIT_NOTE', total: -71000 }),
    ];
    const ids = (status: Parameters<typeof searchInvoices>[2]) => searchInvoices(list, '', status, '2026-11-21').map((i) => i.id);
    expect(ids('ALL')).toHaveLength(5);
    expect(ids('OPEN')).toEqual(['open']);
    expect(ids('PAID')).toEqual(['paid']);
    expect(ids('PARTIALLY_PAID')).toEqual(['partial']);
    expect(ids('CANCELLED')).toEqual(['cancelled']);
    expect(ids('CREDIT_NOTE')).toEqual(['ko']);
    expect(ids('OVERDUE')).toEqual(['open']);
  });
});
