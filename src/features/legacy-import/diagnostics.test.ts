import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildFindingsWorkbook, countByCategory, FINDING_CATEGORIES, formatRows, type FindingCategory } from './diagnostics';
import { buildImportPlan, type Cell, type ExistingKeys, type LegacyWorkbook } from './domain';

// Fictional data only (M-15). One constructed workbook holds one example of every category.
const T = (v: string): Cell => ({ t: 'Text', v });
const N = (v: number): Cell => ({ t: 'Number', v });
const D = (v: string): Cell => ({ t: 'Date', v });
const E: Cell = { t: 'Empty' };
const NONE: ExistingKeys = { families: new Map(), children: new Map(), invoices: new Map() };
const TODAY = '2026-11-21';

const HEADER: Cell[] = [
  T('ustanova'), T('broj računa'), E, T('od'), T('do'), T('datum računa'), T('rok plaćanja'), T('otac'), T('majka'), T('dijete'),
  T('naziv usluge'), E, E, E, E, E, E, E, E, T('iznos'), E, E,
];

interface RowSpec {
  entity?: string; number?: string; father?: string; mother?: string; child?: string; desc?: string;
  qty?: number; price?: number; disc?: number; amount?: Cell; status?: string;
  from?: Cell; to?: Cell; issue?: Cell; due?: Cell;
}

function r(spec: RowSpec): Cell[] {
  const qty = spec.qty ?? 1;
  const price = spec.price ?? 710;
  const disc = spec.disc ?? 0;
  const name = (v: string | undefined, fallback: string): Cell => (v === undefined ? T(fallback) : v === '' ? E : T(v));
  return [
    T('P.U. Test'), T(spec.entity ?? 'IMH'), spec.number === undefined ? E : T(spec.number),
    spec.from ?? D('2026-10-01'), spec.to ?? D('2026-10-31'), spec.issue ?? D('2026-10-01'), spec.due ?? D('2026-10-05'),
    name(spec.father, 'Otac A'), name(spec.mother, 'Majka A'), spec.child === '' ? E : T(`dijete: ${spec.child ?? 'Ana A'}`),
    spec.desc === '' ? E : T(spec.desc ?? 'Školarina za oktobar'), E, T('mj'), N(qty), N(price), N(price), N(disc), E, E,
    spec.amount ?? N(Math.round(qty * price * (1 - disc) * 100) / 100), spec.status ? T(spec.status) : E, E,
  ];
}

const SETTING: Cell[][] = [
  [T('r.br.'), T('otac'), T('majka'), T('dijete'), T('adresa')],
  [E, T('Otac A'), T('Majka A'), T('Ana A'), T('Ulica 1')],
  [E, T('Otac B'), T('Majka B'), T('Bo B'), T('Ulica 2')],
  [E, T('Otac C'), E, T('Ana A'), T('Ulica 3')], // same child name under other parents
  [E, E, E, T('Siroče Bez Roditelja'), E], // register row without parents
];

const B = { father: 'Otac B', mother: 'Majka B', child: 'Bo B' };

/** Expected category per invoice number (the constructed example for each category). */
const DB_ROWS: Cell[][] = [
  r({ number: '001/26', status: 'plaćeno' }), r({ number: '001/26', desc: 'Upisnina', price: 200 }), // PAID_PARTIALLY_FLAGGED
  r({ number: '002/26', due: E }), // DUE_DATE_INVALID
  r({ number: '003/26', from: D('2026-10-31'), to: D('2026-10-01') }), // PERIOD_INVALID
  r({ number: '004/25' }), // NUMBER_YEAR_MISMATCH (+ gaps 1–3 in /25)
  r({ number: '005/26', issue: D('2026-12-01'), due: D('2026-12-05') }), // ISSUE_DATE_IN_FUTURE
  r({ number: '006/26', status: 'djelimično' }), // STATUS_TEXT_UNKNOWN
  r({ number: '007/26', amount: N(700) }), // LINE_AMOUNT_MISMATCH
  r({ number: '008/26', price: 100, disc: 1.5, amount: N(100) }), // DISCOUNT_OUT_OF_RANGE
  r({ number: '009/26', price: 10.005, amount: N(10.005) }), // AMOUNT_ROUNDED
  r({ entity: 'IDSS', number: 'KO-1/26', desc: 'Knjižno odobrenje', price: 50 }), // CREDIT_NOTE_UNLINKED + CREDIT_NOTE_INCONSISTENT
  r({ number: '010/26', amount: N(0) }), // ZERO_TOTAL
  r({ number: '011/26', child: '' }), // NO_CHILD
  r({ number: '012/26', father: 'Otac Nepoznati', mother: '' }), // FAMILY_NOT_IN_REGISTER
  r({ number: '013/26', child: 'Nepoznato Dijete' }), // CHILD_NOT_IN_REGISTER
  r({ number: '014/26' }), r({ number: '014/26', desc: 'Materijal', price: 100, due: D('2026-10-20') }), // LINES_DISAGREE
  r({ number: '015/26' }), r({ number: '016/26', ...B }), r({ number: '015/26', desc: '', amount: N(0) }), // EMPTY_BLOCK_ABSORBED
  r({ number: '017/26' }), r({ number: '017/26', desc: 'Povrat', price: -50 }), // NEGATIVE_LINE
  r({ number: '018/26', desc: 'Nešto treće' }), // ITEM_UNRECOGNISED
  r({ number: '020/26' }), // NUMBER_GAPS (019/26 missing)
  r({ number: '021-B/26' }), // B_SERIES
  r({ number: '022/26', father: '', mother: '' }), // NO_BUYER
  r({ number: '023/26', issue: T('nije datum') }), // ISSUE_DATE_INVALID
  r({ number: '024/26', desc: '', amount: N(0) }), // INVOICE_WITHOUT_LINES
  r({ number: '025/26' }), r({ number: '026/26', ...B }), r({ number: '025/26', ...B, price: 570 }), // NUMBER_REUSED_OTHER_PARTY
  r({ number: '027/26' }), r({ number: '028/26', ...B }), r({ number: '027/26', price: 750 }), // NUMBER_REUSED_SAME_PARTY
];

const workbook = (db: Cell[][] = DB_ROWS): LegacyWorkbook => ({ fileName: 'probni.xlsm', setting: SETTING, db: [HEADER, ...db] });
const ids = (): (() => string) => {
  let n = 0;
  return () => `id-${(n += 1)}`;
};

describe('legacy import diagnostics — every category is detected', () => {
  const { plan, report } = buildImportPlan(workbook(), NONE, ids(), { today: TODAY });
  const found = (category: FindingCategory) => report.findings.filter((f) => f.category === category);

  it('finds every non-blocking category of the specification', () => {
    const expected = (Object.keys(FINDING_CATEGORIES) as FindingCategory[]).filter((c) => FINDING_CATEGORIES[c].severity !== 'BLOCK');
    expect([...new Set(report.findings.map((f) => f.category))].sort()).toEqual(expected.sort());
  });

  it.each<[FindingCategory, string, string]>([
    ['PAID_PARTIALLY_FLAGGED', 'IMH', '001/26'],
    ['DUE_DATE_INVALID', 'IMH', '002/26'],
    ['PERIOD_INVALID', 'IMH', '003/26'],
    ['NUMBER_YEAR_MISMATCH', 'IMH', '004/25'],
    ['ISSUE_DATE_IN_FUTURE', 'IMH', '005/26'],
    ['STATUS_TEXT_UNKNOWN', 'IMH', '006/26'],
    ['DISCOUNT_OUT_OF_RANGE', 'IMH', '008/26'],
    ['AMOUNT_ROUNDED', 'IMH', '009/26'],
    ['CREDIT_NOTE_UNLINKED', 'IDSS', 'KO-1/26'],
    ['CREDIT_NOTE_INCONSISTENT', 'IDSS', 'KO-1/26'],
    ['ZERO_TOTAL', 'IMH', '010/26'],
    ['NO_CHILD', 'IMH', '011/26'],
    ['FAMILY_NOT_IN_REGISTER', 'IMH', '012/26'],
    ['CHILD_NOT_IN_REGISTER', 'IMH', '013/26'],
    ['LINES_DISAGREE', 'IMH', '014/26'],
    ['EMPTY_BLOCK_ABSORBED', 'IMH', '015/26'],
    ['NEGATIVE_LINE', 'IMH', '017/26'],
    ['ITEM_UNRECOGNISED', 'IMH', '018/26'],
    ['B_SERIES', 'IMH', '021-B/26'],
    ['NO_BUYER', 'IMH', '022/26'],
    ['ISSUE_DATE_INVALID', 'IMH', '023/26'],
    ['INVOICE_WITHOUT_LINES', 'IMH', '024/26'],
    ['NUMBER_REUSED_OTHER_PARTY', 'IMH', '025/26'],
    ['NUMBER_REUSED_SAME_PARTY', 'IMH', '027/26'],
  ])('%s → %s %s, with severity from the category and Excel rows', (category, entity, number) => {
    const list = found(category);
    expect(list.map((f) => `${f.entity} ${f.number}`)).toContain(`${entity} ${number}`);
    for (const f of list) {
      expect(f.severity).toBe(FINDING_CATEGORIES[category].severity);
      expect(f.excelRows).toMatch(/^DB \d/);
    }
  });

  it('line amount ≠ quantity × price: listed, and the amount is imported exactly as written (BR-32)', () => {
    expect(found('LINE_AMOUNT_MISMATCH').map((f) => f.number)).toContain('007/26');
    expect(plan.invoices.find((i) => i.number === 'IMH 007/26')?.total).toBe(70000);
  });

  it('register-level findings point to sheet Setting', () => {
    expect(found('REGISTER_ROW_WITHOUT_PARENTS')).toEqual([expect.objectContaining({ severity: 'ISOLATE', excelRows: 'Setting 5' })]);
    expect(found('CHILD_IN_TWO_FAMILIES')).toEqual([expect.objectContaining({ excelRows: 'Setting 2, 4' })]);
  });

  it('gaps are reported per entity and year', () => {
    const gaps = found('NUMBER_GAPS').map((f) => [f.entity, f.number, f.reason]);
    expect(gaps).toContainEqual(['IMH', '…/26', 'Nedostaje 2 brojeva: 4, 19.']); // 004 is written as 004/25 in the fixture
    expect(gaps).toContainEqual(['IMH', '…/25', 'Nedostaje 3 brojeva: 1–3.']);
  });

  it('ISOLATE removes exactly the isolated invoices; their numbers stay reserved', () => {
    const numbers = plan.invoices.map((i) => i.number);
    for (const n of ['022/26', '023/26', '024/26']) expect(numbers).not.toContain(`IMH ${n}`);
    expect(plan.invoices.filter((i) => i.number === 'IMH 025/26')).toEqual([expect.objectContaining({ buyerName: 'Otac A', total: 71000 })]);
    expect(report.isolated.map((i) => i.number).sort()).toEqual(['022/26', '023/26', '024/26', '025/26', '027/26']);
    expect(plan.sequences).toContainEqual({ entity: 'IMH', year: 2026, lastNumber: 28 });
  });

  it('defaults are reported, never silent: missing due date and period become the invoice date', () => {
    expect(plan.invoices.find((i) => i.number === 'IMH 002/26')).toMatchObject({ dueDate: '2026-10-01' });
  });

  it('findings never contain personal data (BR-22)', () => {
    const json = JSON.stringify(report.findings);
    for (const name of ['Otac', 'Majka', 'Ana', 'Bo B', 'Siroče', 'Nepoznat']) expect(json).not.toContain(name);
  });

  it('counts per category follow severity order', () => {
    const counts = countByCategory(report.findings);
    const order = ['BLOCK', 'ISOLATE', 'REVIEW', 'INFO'];
    expect(counts.map((c) => order.indexOf(c.severity))).toEqual([...counts.map((c) => order.indexOf(c.severity))].sort((a, b) => a - b));
    expect(counts.reduce((total, c) => total + c.count, 0)).toBe(report.findings.length);
  });
});

describe('legacy import diagnostics — blocking categories', () => {
  it('lists every blocking problem in one message and imports nothing', () => {
    const rows = [
      r({ number: '001/26', amount: T('devetsto') }),
      r({ entity: 'XYZ', number: '002/26' }),
      r({ number: undefined, desc: 'Školarina' }),
      r({ number: '003/26', amount: T('9oo') }),
    ];
    expect(() => buildImportPlan(workbook(rows), NONE, ids(), { today: TODAY })).toThrow(
      /Iznos nije broj: 2 \(list „DB“, red: 2, 5\); Nepoznata ustanova: 1 \(list „DB“, red: 3\); Stavka bez broja računa: 1 \(list „DB“, red: 4\)/,
    );
  });
});

describe('legacy import diagnostics — re-import on go-live day', () => {
  it('reports the categories for the whole workbook again and pays the flagged lines of a newly paid invoice', () => {
    const first = buildImportPlan(workbook(), NONE, ids(), { today: TODAY });
    const existing: ExistingKeys = {
      families: new Map(first.plan.families.map((f) => [f.legacyKey, f.family.id])),
      children: new Map(first.plan.children.map((c) => [c.legacyKey, c.child.id])),
      invoices: new Map(first.plan.invoices.map((i) => [i.number, { id: i.id, paid: 0 }])),
    };
    const again = buildImportPlan(workbook(), existing, ids(), { today: TODAY });
    expect(again.plan.invoices).toEqual([]);
    expect(again.report.findings.filter((f) => f.severity === 'REVIEW').length).toBe(first.report.findings.filter((f) => f.severity === 'REVIEW').length);
    expect(again.plan.paymentsForExisting.find((p) => p.invoiceId === first.plan.invoices.find((i) => i.number === 'IMH 001/26')?.id)?.payment.amount).toBe(71000);
  });
});

describe('Excel report for the accountant (Q3)', () => {
  const { report } = buildImportPlan(workbook(), NONE, ids(), { today: TODAY });
  const files = unzipSync(buildFindingsWorkbook(report.findings, { fileName: 'probni.xlsm', date: TODAY }));
  const text = (name: string): string => strFromU8(files[name] ?? new Uint8Array());

  it('has a summary, an all-findings sheet and one sheet per category', () => {
    const sheets = [...text('xl/workbook.xml').matchAll(/<sheet name="([^"]+)"/g)].map((m) => m[1]);
    expect(sheets[0]).toBe('Sažetak');
    expect(sheets[1]).toBe('Svi nalazi');
    expect(sheets).toHaveLength(2 + countByCategory(report.findings).length);
    expect(sheets.every((name) => (name ?? '').length <= 31 && !/[:\\/?*[\]]/.test(name ?? ''))).toBe(true);
    expect(text('xl/worksheets/sheet2.xml').match(/<row /g)).toHaveLength(report.findings.length + 1);
  });

  it('never writes a formula, and text that looks like one stays text (E-4)', () => {
    const bytes = buildFindingsWorkbook(
      [{ category: 'ZERO_TOTAL', severity: 'REVIEW', entity: 'IMH', number: '=1+1', excelRows: 'DB 2', reason: '<b>&', amount: 0 }],
      { fileName: 'x', date: TODAY },
    );
    const all = Object.values(unzipSync(bytes)).map((b) => strFromU8(b)).join('');
    expect(all).not.toMatch(/<f>/);
    expect(all).toContain('<t xml:space="preserve">=1+1</t>');
    expect(all).toContain('&lt;b&gt;&amp;');
  });
});

describe('formatRows', () => {
  it('compresses ranges', () => {
    expect(formatRows([9, 4, 5, 6, 6])).toBe('4–6, 9');
    expect(formatRows([1, 3, 5], 2)).toBe('1, 3 … (+1)');
  });
});
