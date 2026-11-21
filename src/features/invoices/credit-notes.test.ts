import { describe, expect, it } from 'vitest';
import { creditByEntity, creditableLines, creditNoteLines, creditNoteTotal, CreditNoteError, invoiceBalance } from './credit-notes';
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

describe('family credit per institution (S3)', () => {
  it('sums per entity and never mixes IMH and IDSS', () => {
    const credit = creditByEntity([
      { entity: 'IDSS', credit: 70000 },
      { entity: 'IMH', credit: 5000 },
      { entity: 'IDSS', credit: 1000 },
    ]);
    expect([...credit]).toEqual([['IDSS', 71000], ['IMH', 5000]]);
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
