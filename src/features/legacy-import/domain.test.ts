import { describe, expect, it } from 'vitest';
import { buildImportPlan, decimalOf, itemCodeOf, PAYMENT_NOTE, sequenceOf, type Cell, type ExistingKeys, type LegacyWorkbook } from './domain';

// Fictional data only (M-15).
const T = (v: string): Cell => ({ t: 'Text', v });
const N = (v: number): Cell => ({ t: 'Number', v });
const D = (v: string): Cell => ({ t: 'Date', v });
const E: Cell = { t: 'Empty' };

const HEADER: Cell[] = [
  T('ustanova'), T('broj računa'), E, T('od'), T('do'), T('datum računa'), T('rok plaćanja'), T('otac'), T('majka'), T('dijete'),
  T('naziv usluge'), E, E, E, E, E, E, E, E, T('iznos'), E, E,
];

function line(entity: string, number: string, opts: Partial<{ father: string; mother: string; child: string; desc: string; qty: number; price: number; rabat: number; amount: number; paid: boolean; due: Cell; issue: Cell }>): Cell[] {
  const qty = opts.qty ?? 1;
  const price = opts.price ?? 0;
  const amount = opts.amount ?? qty * price * (1 - (opts.rabat ?? 0));
  return [
    T(entity === 'IMH' ? 'P.P.U. Test' : 'P.U. Test'), T(entity), T(` ${number}`), D('2026-10-01'), D('2026-10-31'),
    opts.issue ?? D('2026-09-20'), opts.due ?? D('2026-10-05'), opts.father ? T(opts.father) : N(0), opts.mother ? T(opts.mother) : N(0),
    T(`dijete: ${opts.child ?? ''}`), opts.desc ? T(opts.desc) : E, E, T('srv'), N(qty), N(price), N(price), N(opts.rabat ?? 0), N(0), N(0),
    N(amount), opts.paid ? T('plaćeno') : E, E,
  ];
}

const FAMILY = { father: 'Otac Prvi', mother: 'Majka Prva', child: 'Dijete Prvo' };

function workbook(): LegacyWorkbook {
  return {
    fileName: 'test.xlsm',
    setting: [
      [T('r.br.'), T('otac'), T('majka'), T('dijete'), T('adresa')],
      [E, T('Otac Prvi'), T('Majka Prva'), T('Dijete Prvo'), T('Ulica 1')],
      [E, T('Otac Prvi'), T('Majka Prva'), T('Dijete Drugo'), T('Ulica 1')],
      [E, T('-'), T('Majka Druga'), T('Dijete Trece'), T('Ulica 2')],
    ],
    db: [
      [T('Evidencija izdatih računa')], [], [], [], [], [], [E, E, E, T('obračunski period')],
      HEADER,
      line('IMH', '895/26', { ...FAMILY, desc: 'Školarina za oktobar - školska 2026/27', price: 710, paid: true }),
      line('IMH', '895/26', { ...FAMILY, desc: 'Upisnina', price: 200, paid: false }),
      line('IMH', '895/26', { ...FAMILY }), // empty template row
      line('IMH', '896-B/26', { father: 'Otac Prvi', mother: 'Majka Prva', child: 'Dijete Drugo', desc: 'Doručak za oktobar', qty: 4, price: 15, rabat: 0.05 }),
      line('IDSS', '568/26', { mother: 'Majka Druga', child: 'Dijete Trece', desc: 'Školarina za septembar', price: 919.16, due: T('05.20.20266') }),
      line('IDSS', 'KO-35/26', { mother: 'Majka Druga', child: 'Dijete Trece', desc: 'Knjižno odobrenje', price: -919.16 }),
      line('IDSS', '001/23', { mother: 'Majka Druga', child: 'Dijete Trece', desc: 'Upisnina', price: 1000, issue: T('16.01.2023.') , due: E }),
      line('IMH', '897/26', { desc: 'Bez kupca', price: 10 }),
    ],
  };
}

const NONE: ExistingKeys = { families: new Map(), children: new Map(), invoices: new Map() };

function ids(): () => string {
  let n = 0;
  return () => `id-${(n += 1)}`;
}

describe('legacy import helpers', () => {
  it('numbers and item codes', () => {
    expect(sequenceOf('754-B/26')).toEqual({ sequence: 754, year: 2026 });
    expect(sequenceOf('001/23')).toEqual({ sequence: 1, year: 2023 });
    expect(sequenceOf('KO-35/26')).toBeNull();
    expect(itemCodeOf('Školarina za mart- školska 2025/26')).toBe('TUITION');
    expect(itemCodeOf('Doruča za april')).toBe('BREAKFAST');
    expect(itemCodeOf('Odluka o stipendiranju za školsku 2025/26')).toBe('SCHOLARSHIP');
    expect(itemCodeOf('Nešto treće')).toBe('OTHER');
  });
});

describe('legacy import plan', () => {
  const { plan, report } = buildImportPlan(workbook(), NONE, ids());

  it('keeps numbers and amounts, skips empty rows, marks credit notes', () => {
    const byNumber = new Map(plan.invoices.map((i) => [i.number, i]));
    expect([...byNumber.keys()].sort()).toEqual(['IDSS 001/23', 'IDSS 568/26', 'IDSS KO-35/26', 'IMH 895/26', 'IMH 896-B/26']);
    const first = byNumber.get('IMH 895/26');
    expect(first?.lines.map((l) => [l.itemCode, l.amount])).toEqual([['TUITION', 71000], ['ENROLMENT_FEE', 20000]]);
    expect(first?.total).toBe(91000);
    expect(byNumber.get('IMH 896-B/26')?.lines[0]).toMatchObject({ itemCode: 'BREAKFAST', listAmount: 6000, amount: 5700 });
    expect(byNumber.get('IMH 896-B/26')?.lines[0]?.description).toContain('rabat 5%');
    expect(byNumber.get('IDSS KO-35/26')).toMatchObject({ kind: 'CREDIT_NOTE', total: -91916, payment: null });
    expect(byNumber.get('IDSS 001/23')?.issueDate).toBe('2023-01-16');
  });

  it('paid flag on some lines only → payment of the flagged lines on the due date, marked for review (Director, Q1)', () => {
    const paid = plan.invoices.find((i) => i.number === 'IMH 895/26')?.payment;
    expect(paid).toMatchObject({ paidOn: '2026-10-05', amount: 71000, payerName: 'Otac Prvi', note: PAYMENT_NOTE });
    expect(report.findings.filter((f) => f.category === 'PAID_PARTIALLY_FLAGGED')).toEqual([
      expect.objectContaining({ severity: 'REVIEW', entity: 'IMH', number: '895/26', amount: 71000 }),
    ]);
    expect(plan.invoices.find((i) => i.number === 'IMH 896-B/26')?.payment).toBeNull();
  });

  it('families from Setting and invoices; father is the buyer, mother when there is no father', () => {
    expect(plan.families).toHaveLength(2);
    const first = plan.families.find((f) => f.legacyKey.startsWith('otac prvi'));
    expect(first?.family).toMatchObject({ displayName: 'Prvo', address: 'Ulica 1' });
    expect(first?.guardians.map((g) => [g.role, g.isPayer])).toEqual([['FATHER', true], ['MOTHER', false]]);
    const second = plan.families.find((f) => f.legacyKey.startsWith('|majka druga'));
    expect(second?.guardians.map((g) => [g.role, g.isPayer])).toEqual([['MOTHER', true]]);
    expect(plan.children).toHaveLength(3);
    expect(plan.children.every((c) => c.child.dateOfBirth === null && c.child.importReview)).toBe(true);
    const invoice = plan.invoices.find((i) => i.number === 'IDSS 568/26');
    expect(invoice?.familyId).toBe(second?.family.id);
    expect(invoice?.childId).toBe(plan.children.find((c) => c.child.firstName === 'Dijete' && c.child.lastName === 'Trece')?.child.id);
    expect(invoice?.buyerName).toBe('Majka Druga');
  });

  it('numbering continues after the highest number in the workbook per entity and year (not credit notes)', () => {
    // 897/26 is skipped (no buyer) but was issued in the old solution, so its number is never reused.
    expect(plan.sequences).toEqual(
      expect.arrayContaining([
        { entity: 'IMH', year: 2026, lastNumber: 897 },
        { entity: 'IDSS', year: 2026, lastNumber: 568 },
        { entity: 'IDSS', year: 2023, lastNumber: 1 },
      ]),
    );
  });

  it('reports problems instead of skipping silently', () => {
    expect(report.findings.some((f) => f.category === 'DUE_DATE_INVALID' && f.number === '568/26' && f.reason.includes('nije stvaran datum'))).toBe(true);
    expect(report.findings.some((f) => f.category === 'NO_BUYER' && f.number === '897/26' && f.severity === 'ISOLATE')).toBe(true);
    expect(report.byEntity.IMH).toMatchObject({ invoices: 2, paid: 1 });
    expect(report.byEntity.IDSS).toMatchObject({ invoices: 3, creditNotes: 1 });
  });

  it('a re-import adds nothing twice and only books newly paid invoices', () => {
    const existing: ExistingKeys = {
      families: new Map(plan.families.map((f) => [f.legacyKey, f.family.id])),
      children: new Map(plan.children.map((c) => [c.legacyKey, c.child.id])),
      invoices: new Map(plan.invoices.map((i) => [i.number, { id: i.id, paid: i.number === 'IMH 895/26' ? 91000 : 0 }])),
    };
    const book = workbook();
    const db = book.db.map((row) => [...row]);
    db[11] = line('IMH', '896-B/26', { father: 'Otac Prvi', mother: 'Majka Prva', child: 'Dijete Drugo', desc: 'Doručak za oktobar', qty: 4, price: 15, rabat: 0.05, paid: true });
    const again = buildImportPlan({ ...book, db }, existing, ids());
    expect(again.plan.families).toEqual([]);
    expect(again.plan.children).toEqual([]);
    expect(again.plan.invoices).toEqual([]);
    expect(again.plan.paymentsForExisting).toHaveLength(1);
    expect(again.plan.paymentsForExisting[0]?.payment.amount).toBe(5700);
    expect(again.report.invoicesExisting).toBe(5);
  });

  it('refuses a workbook whose DB sheet has a different structure', () => {
    const book = workbook();
    const db = book.db.map((row) => [...row]);
    db[7] = HEADER.map((c, i) => (i === 19 ? T('nešto drugo') : c));
    expect(() => buildImportPlan({ ...book, db }, NONE, ids())).toThrow(/struktura/);
  });
});

describe('legacy import integrity (forensic 2026-11-21)', () => {
  const book = (rows: Cell[][]): LegacyWorkbook => ({ fileName: 'dup.xlsm', setting: [[T('r.br.')]], db: [HEADER, ...rows] });
  const PRVI = { father: 'Otac Prvi', child: 'Dijete Prvo' };
  const DRUGI = { father: 'Otac Drugi', child: 'Dijete Drugo' };

  it('the same number in a separate block for another buyer is isolated, never merged or marked paid', () => {
    const { plan, report } = buildImportPlan(
      book([
        line('IDSS', '363/26', { ...PRVI, desc: 'Školarina jul', price: 919.19, paid: true }),
        line('IDSS', '100/26', { ...PRVI, desc: 'Školarina jul', price: 500 }),
        line('IDSS', '363/26', { ...DRUGI, desc: 'Školarina avgust', price: 808.34 }),
      ]),
      NONE,
      ids(),
    );
    const kept = plan.invoices.find((i) => i.number === 'IDSS 363/26');
    expect(kept).toMatchObject({ buyerName: 'Otac Prvi', total: 91919 });
    expect(kept?.lines).toHaveLength(1);
    expect(kept?.payment?.amount).toBe(91919);
    expect(plan.invoices.filter((i) => i.number === 'IDSS 363/26')).toHaveLength(1);
    expect(report.isolated).toEqual([
      { entity: 'IDSS', number: '363/26', excelRows: 'DB 4', buyerName: 'Otac Drugi', childName: 'Dijete Drugo', total: 80834, reason: 'Broj ponovljen - drugi kupac' },
    ]);
    expect(report.findings.filter((f) => f.category === 'NUMBER_REUSED_OTHER_PARTY')).toEqual([
      expect.objectContaining({ severity: 'ISOLATE', entity: 'IDSS', number: '363/26', excelRows: 'DB 4', amount: 80834 }),
    ]);
    expect(JSON.stringify(report.findings)).not.toContain('Otac'); // no personal data in findings (BR-22)
  });

  it('a second block of the same buyer with money is isolated too; an empty block of the same buyer is absorbed', () => {
    const { plan, report } = buildImportPlan(
      book([
        line('IMH', '010/26', { ...PRVI, desc: 'Školarina jul', price: 710 }),
        line('IMH', '011/26', { ...DRUGI, desc: 'Školarina jul', price: 710 }),
        line('IMH', '010/26', { ...PRVI }), // empty template row of 010/26, separated by sorting
        line('IMH', '012/26', { ...DRUGI, desc: 'Školarina jul', price: 710 }),
        line('IMH', '010/26', { ...PRVI, desc: 'Školarina avgust', price: 710 }),
      ]),
      NONE,
      ids(),
    );
    expect(plan.invoices.find((i) => i.number === 'IMH 010/26')?.total).toBe(71000);
    expect(report.isolated.map((i) => [i.number, i.total, i.reason])).toEqual([['010/26', 71000, 'Broj ponovljen - isti kupac']]);
  });

  it('an empty first block does not hide the real invoice that follows later', () => {
    const { plan, report } = buildImportPlan(
      book([line('IMH', '020/26', { ...PRVI }), line('IMH', '021/26', { ...DRUGI, desc: 'Školarina', price: 570 }), line('IMH', '020/26', { ...PRVI, desc: 'Školarina', price: 750 })]),
      NONE,
      ids(),
    );
    expect(plan.invoices.find((i) => i.number === 'IMH 020/26')?.total).toBe(75000);
    expect(report.isolated).toEqual([]);
  });

  it('amounts typed as text are read exactly; an unreadable amount stops the import instead of becoming 0 KM', () => {
    const withAmount = (amount: Cell, number: string): Cell[] => line('IMH', number, { ...PRVI, desc: 'Školarina', price: 1 }).map((c, i) => (i === 19 ? amount : c));
    const ok = buildImportPlan(book([withAmount(T('1.234,50'), '030/26'), withAmount(T('450,00 KM'), '031/26'), withAmount(T('-125'), '032/26')]), NONE, ids());
    expect(ok.plan.invoices.map((i) => i.total)).toEqual([123450, 45000, -12500]);
    expect(() => buildImportPlan(book([withAmount(T('devetsto'), '033/26'), withAmount(T('9oo'), '034/26')]), NONE, ids())).toThrow(/Iznos nije broj: 2 \(list „DB“, red: 2, 3\)/);
  });

  it('decimalOf reads bs-BA and plain notation and refuses everything else', () => {
    const cases: Array<[string, number | null]> = [
      ['1.234,50', 1234.5], ['450,00', 450], ['919.19', 919.19], ['1.500', 1500], ['0.125', 0.125], ['-919,16', -919.16],
      ['1 234,50 KM', 1234.5], ['12', 12], ['abc', null], ['1,2,3', null], ['4..5', null], ['', null],
    ];
    for (const [raw, expected] of cases) expect([raw, decimalOf(raw)]).toEqual([raw, expected]);
  });
});

describe('legacy credit notes continue the credit-note series (storno S1)', () => {
  it('the plan carries the highest KO number per entity and year', () => {
    const { plan } = buildImportPlan(workbook(), NONE, ids());
    expect(plan.creditNoteSequences).toEqual([{ entity: 'IDSS', year: 2026, lastNumber: 35 }]);
  });
});
