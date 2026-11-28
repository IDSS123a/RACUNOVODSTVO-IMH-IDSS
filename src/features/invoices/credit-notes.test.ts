import { describe, expect, it } from 'vitest';
import { BALANCE_LABEL, creditableLines, creditNoteLines, creditNoteTotal, CreditNoteError, invoiceBalance } from './credit-notes';
import { summarisePayments } from './domain';
import { creditNoteSequenceOf } from '@/features/legacy-import/domain';

// Mirrors the backend tests in src-tauri/src/credit_notes.rs (one definition of the balance, M-7).

describe('effective balance', () => {
  it('net = total + credited; open and credit never negative', () => {
    expect(invoiceBalance({ total: 70000, credited: 0, paid: 0 })).toMatchObject({ net: 70000, open: 70000, credit: 0, status: 'OPEN' });
    expect(invoiceBalance({ total: 70000, credited: -5000, paid: 30000 })).toMatchObject({ net: 65000, open: 35000, status: 'PARTIALLY_PAID' });
    expect(invoiceBalance({ total: 70000, credited: -5000, paid: 65000 })).toMatchObject({ open: 0, credit: 0, status: 'PAID' });
  });

  it('a fully credited invoice is cancelled; money paid on it becomes credit (S3)', () => {
    expect(invoiceBalance({ total: 70000, credited: -70000, paid: 0 })).toMatchObject({ net: 0, status: 'CANCELLED', credit: 0 });
    expect(invoiceBalance({ total: 70000, credited: -70000, paid: 70000 })).toMatchObject({ net: 0, status: 'CANCELLED', credit: 70000 });
  });

  it('summarisePayments keeps its old answers and delegates (M-7)', () => {
    expect(summarisePayments(71000, [50000])).toEqual({ total: 71000, paid: 50000, open: 21000, credit: 0, status: 'PARTIALLY_PAID' });
    expect(summarisePayments(71000, [50000, 30000])).toEqual({ total: 71000, paid: 80000, open: 0, credit: 9000, status: 'OVERPAID' });
    expect(summarisePayments(71000, [])).toMatchObject({ status: 'OPEN' });
  });
});

describe('credit-note lines (S2)', () => {
  const lines = creditableLines(
    [
      { description: 'Školarina', amount: 50000 },
      { description: 'Doručak', amount: 20000 },
      { description: 'Stipendija', amount: -10000 },
    ],
    [{ position: 2, amount: -5000 }],
  );

  it('remaining per line accounts for earlier credit notes; negative lines are not creditable', () => {
    expect(lines.map((l) => l.remaining)).toEqual([50000, 15000, 0]);
  });

  it('WHOLE credits everything still open, line by line', () => {
    const out = creditNoteLines(lines, { kind: 'WHOLE' });
    expect(out).toEqual([{ position: 1, amount: -50000 }, { position: 2, amount: -15000 }]);
    expect(creditNoteTotal(out)).toBe(-65000);
  });

  it('LINES credits chosen amounts and refuses more than remains', () => {
    expect(creditNoteLines(lines, { kind: 'LINES', amounts: new Map([[2, 15000]]) })).toEqual([{ position: 2, amount: -15000 }]);
    expect(() => creditNoteLines(lines, { kind: 'LINES', amounts: new Map([[2, 15001]]) })).toThrow(CreditNoteError);
    expect(() => creditNoteLines(lines, { kind: 'LINES', amounts: new Map([[3, 100]]) })).toThrow(/najviše 0 KM/);
    expect(() => creditNoteLines(lines, { kind: 'LINES', amounts: new Map([[9, 100]]) })).toThrow(/nema stavku 9/);
    expect(() => creditNoteLines(lines, { kind: 'LINES', amounts: new Map() })).toThrow(/barem jednu/);
    expect(() => creditNoteLines(lines, { kind: 'LINES', amounts: new Map([[1, 12.5]]) })).toThrow(/veći od nule/);
  });

  it('nothing left to credit is refused', () => {
    const done = creditableLines([{ description: 'Š', amount: 100 }], [{ position: 1, amount: -100 }]);
    expect(() => creditNoteLines(done, { kind: 'WHOLE' })).toThrow(CreditNoteError);
  });
});

describe('legacy credit-note numbers (S1)', () => {
  it('KO-35/26 continues the IDSS series in 2026', () => {
    expect(creditNoteSequenceOf('KO-35/26')).toEqual({ sequence: 35, year: 2026 });
    expect(creditNoteSequenceOf('ko-033/26')).toEqual({ sequence: 33, year: 2026 });
    expect(creditNoteSequenceOf('363/26')).toBeNull();
    expect(creditNoteSequenceOf('KO-35')).toBeNull();
  });
});

describe('payment warnings (Director, 2026-11-28: 1.000 KM booked twice on a paid invoice without a word)', () => {
  it('a paid invoice, an overpayment and the same payment again are each said; a normal payment is quiet', async () => {
    const { paymentWarnings } = await import('./credit-notes');
    const first = [{ paidOn: '2026-11-27', amount: 100000, reversedOn: null }];
    expect(paymentWarnings(100000, 100000, '2026-11-27', [])).toEqual([]);
    expect(paymentWarnings(100000, 40000, '2026-11-27', [])).toEqual([]);
    const paid = paymentWarnings(0, 100000, '2026-11-27', first);
    expect(paid[0]).toContain('već plaćen u cijelosti');
    expect(paid[1]).toContain('s datumom 27.11.2026. je već evidentirana');
    expect(paymentWarnings(50000, 80000, '2026-11-28', [])[0]).toContain('veći od preostalog');
    expect(paymentWarnings(50000, 100000, '2026-11-28', first)[1]).toContain('(drugi datum)');
    // a reversed payment does not count
    expect(paymentWarnings(100000, 100000, '2026-11-27', [{ paidOn: '2026-11-27', amount: 100000, reversedOn: '2026-11-28' }])).toEqual([]);
    expect(paymentWarnings(0, 0, '2026-11-27', first)).toEqual([]);
  });
});

describe('saldo as on a customer ledger card (Director, 2026-11-28: „nema zaduženja a korisnik plati = u pretplati“)', () => {
  it('charged − paid: positive owes, negative is a prepayment shown with a minus, zero settled', async () => {
    const { saldoText } = await import('./credit-notes');
    // IMH-897/26: 1.420 KM − KO 420 KM = 1.000 KM charged, 2.000 KM paid → the invoice is paid, its 1.000 KM excess
    // is the child's prepayment (Q4); the child's saldo −1.000,00 KM comes from the backend (prepayments.rs)
    expect(invoiceBalance({ total: 142000, credited: -42000, paid: 200000 })).toMatchObject({ open: 0, credit: 100000, status: 'OVERPAID' });
    expect(BALANCE_LABEL.OVERPAID).toBe('Plaćen · višak u pretplati');
    expect(saldoText(-100000).replace(/\u2212/g, '-')).toBe('-1.000,00 KM (u pretplati)');
    expect(saldoText(42000)).toBe('420,00 KM (duguje)');
    expect(saldoText(0)).toBe('0,00 KM (izmireno)');
  });
});

describe('payment without an invoice — warnings (specs/family-advance §2)', () => {
  it('an unpaid invoice of the child and the same payment again are said; otherwise quiet', async () => {
    const { prepaymentWarnings } = await import('./credit-notes');
    expect(prepaymentWarnings(100000, '2026-11-28', [], [])).toEqual([]);
    expect(prepaymentWarnings(0, '2026-11-28', [{ number: 'IMH-001/26', open: 71000 }], [])).toEqual([]);
    const w = prepaymentWarnings(100000, '2026-11-28', [{ number: 'IMH-001/26', open: 71000 }], [{ paidOn: '2026-11-28', amount: 100000, reversedOn: null }]);
    expect(w[0]).toContain('neplaćen račun IMH-001/26');
    expect(w[1]).toContain('28.11.2026. je već evidentirana');
    expect(prepaymentWarnings(100000, '2026-11-28', [], [{ paidOn: '2026-11-28', amount: 100000, reversedOn: '2026-11-29' }])).toEqual([]);
  });
});
