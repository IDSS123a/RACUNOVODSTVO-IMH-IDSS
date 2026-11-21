import { describe, expect, it } from 'vitest';
import { CODE39, code39Bars, WIDE } from './code39';
import { formatDiscount, invoiceRecap } from './recap';

describe('invoice recapitulation (F1 C5, C7)', () => {
  it('the sample invoice: 680,00 KM, no discount', () => {
    const recap = invoiceRecap([{ itemCode: 'TUITION', description: 'Školarina za oktobar - školska 2026/2027', listAmount: 68000, amount: 68000 }]);
    expect(recap).toMatchObject({ salesValue: 68000, discount: 0, netValue: 68000, vat: 0, total: 68000 });
    expect(recap.lines[0]).toMatchObject({ unit: 'srv', quantity: 1, price: 68000, discounted: 68000, discountBp: 0, vatPercent: 0, vat: 0, netAmount: 68000 });
  });

  it('a board discount and one-time items: JM kom, discount shown in % and in KM', () => {
    const recap = invoiceRecap([
      { itemCode: 'TUITION', description: 'Školarina', listAmount: 71000, amount: 62125 },
      { itemCode: 'ENROLMENT_FEE', description: 'Upisnina', listAmount: 20000, amount: 20000 },
      { itemCode: 'DEPOSIT', description: 'Depozit', listAmount: 71000, amount: 71000 },
    ]);
    expect(recap.lines.map((l) => [l.unit, formatDiscount(l.discountBp)])).toEqual([['srv', '12,5%'], ['kom', '0%'], ['kom', '0%']]);
    expect(recap).toMatchObject({ salesValue: 162000, discount: 8875, netValue: 153125, total: 153125 });
  });

  it('for 10.000 random invoices every figure adds up to the fening', () => {
    let seed = 7;
    const random = (): number => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    let bad = 0;
    for (let n = 0; n < 10_000; n += 1) {
      const lines = Array.from({ length: 1 + Math.floor(random() * 6) }, () => {
        const listAmount = 1 + Math.floor(random() * 2_000_000);
        const amount = listAmount - Math.floor(random() * listAmount * 0.5);
        return { itemCode: random() < 0.5 ? 'TUITION' : 'MATERIALS', description: 'x', listAmount, amount };
      });
      const r = invoiceRecap(lines);
      const sumLines = r.lines.reduce((a, l) => a + l.netAmount, 0);
      const ok =
        sumLines === r.netValue &&
        r.netValue === r.total &&
        r.salesValue - r.discount === r.netValue &&
        r.vat === 0 &&
        r.salesValue === lines.reduce((a, l) => a + l.listAmount, 0) &&
        r.lines.every((l) => Number.isSafeInteger(l.price) && Number.isSafeInteger(l.netAmount));
      if (!ok) bad += 1;
    }
    expect(bad).toBe(0);
  });

  it('credit notes (negative lines) keep the identities', () => {
    const r = invoiceRecap([{ itemCode: 'TUITION', description: 'Storno', listAmount: -71000, amount: -71000 }]);
    expect(r).toMatchObject({ salesValue: -71000, discount: 0, netValue: -71000, total: -71000 });
    expect(r.lines[0]?.discountBp).toBe(0);
  });
});

/** Decode bars back to text, as a scanner would (narrow = 1, wide = WIDE). */
function decode(bars: ReadonlyArray<{ x: number; width: number }>): string {
  const byPattern = new Map(Object.entries(CODE39).map(([ch, p]) => [p, ch]));
  let text = '';
  for (let i = 0; i < bars.length; i += 5) {
    const group = bars.slice(i, i + 5);
    let pattern = '';
    group.forEach((bar, k) => {
      pattern += bar.width === WIDE ? '1' : '0';
      const next = group[k + 1];
      if (next) pattern += next.x - (bar.x + bar.width) === WIDE ? '1' : '0';
    });
    const ch = byPattern.get(pattern);
    if (ch === undefined) throw new Error(`unknown pattern ${pattern}`);
    text += ch;
  }
  return text;
}

describe('Code 39 barcode of the invoice number (F1 C2)', () => {
  it('every pattern has 9 elements, exactly 3 wide, and all patterns are distinct', () => {
    const patterns = Object.values(CODE39);
    expect(patterns.every((p) => p.length === 9 && [...p].filter((c) => c === '1').length === 3)).toBe(true);
    expect(new Set(patterns).size).toBe(patterns.length);
  });

  it('matches the document encoder for digits and the start/stop character', () => {
    // c39 in IMH-IDSS-Fakturisanje.html: n = narrow, w = wide
    const doc: Record<string, string> = {
      '0': 'nnnwwnwnn', '1': 'wnnwnnnnw', '2': 'nnwwnnnnw', '3': 'wnwwnnnnn', '4': 'nnnwwnnnw',
      '5': 'wnnwwnnnn', '6': 'nnwwwnnnn', '7': 'nnnwnnwnw', '8': 'wnnwnnwnn', '9': 'nnwwnnwnn', '*': 'nwnnwnwnn',
    };
    for (const [ch, p] of Object.entries(doc)) expect(CODE39[ch]).toBe(p.replace(/n/g, '0').replace(/w/g, '1'));
  });

  it.each(['IMH-004/26', 'IDSS-569/26', 'IMH-KO-001/26', 'IDSS-KO-036/26'])('decodes back to %s', (number) => {
    expect(decode(code39Bars(number).bars)).toBe(`*${number}*`);
  });

  it('refuses characters outside Code 39 (e.g. Č) instead of dropping them', () => {
    expect(() => code39Bars('IMH Č')).toThrow(/Č/);
  });
});
