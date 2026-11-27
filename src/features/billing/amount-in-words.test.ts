import { describe, expect, it } from 'vitest';
import { MoneyError } from './money';
import { amountInWords, integerInWords } from './amount-in-words';

/**
 * The document's own function, copied verbatim from IMH-IDSS-Fakturisanje.html (`slova`, line 57334),
 * used as the reference: below one million the wording must be identical (F1 / SPEC C8).
 */
function documentSlova(n2: number): string {
  const c4 = Math.floor(Math.abs(n2) + 1e-9), d2 = Math.round((Math.abs(n2) - c4) * 100);
  const o3 = '|jedan|dva|tri|četiri|pet|šest|sedam|osam|devet|deset|jedanaest|dvanaest|trinaest|četrnaest|petnaest|šesnaest|sedamnaest|osamnaest|devetnaest'.split('|');
  const t3 = '||dvadeset|trideset|četrdeset|pedeset|šezdeset|sedamdeset|osamdeset|devedeset'.split('|');
  const st2 = '|sto|dvije stotine|tri stotine|četiri stotine|pet stotina|šest stotina|sedam stotina|osam stotina|devet stotina'.split('|');
  const h3 = (x: number): string => {
    let x3 = x;
    const r2: string[] = [];
    if (x3 >= 100) r2.push(st2[Math.floor(x3 / 100)] ?? '');
    x3 %= 100;
    if (x3 >= 20) r2.push((t3[Math.floor(x3 / 10)] ?? '') + (x3 % 10 ? ' i ' + (o3[x3 % 10] ?? '') : ''));
    else if (x3) r2.push(o3[x3] ?? '');
    return r2.join(' ');
  };
  const th = Math.floor(c4 / 1e3), lo = c4 % 1e3;
  let w2 = '';
  if (th) {
    let a3 = h3(th);
    const m4 = th % 100, l3 = th % 10;
    if (l3 === 1 || l3 === 2) a3 = a3.replace(/jedan$/, 'jedna').replace(/dva$/, 'dvije');
    w2 = a3 + ' ' + (m4 > 10 && m4 < 20 ? 'hiljada' : l3 === 1 ? 'hiljada' : l3 === 2 || l3 === 3 || l3 === 4 ? 'hiljade' : 'hiljada');
  }
  if (lo) w2 += (w2 ? ' ' : '') + h3(lo);
  return (n2 < 0 ? 'minus ' : '') + (w2 || 'nula') + ' i ' + String(d2).padStart(2, '0') + '/100 KM';
}

describe('amount in words — the document wording', () => {
  it.each([
    [0, 'nula'],
    [1, 'jedan'],
    [2, 'dva'],
    [11, 'jedanaest'],
    [21, 'dvadeset i jedan'],
    [60, 'šezdeset'],
    [100, 'sto'],
    [222, 'dvije stotine dvadeset i dva'],
    [570, 'pet stotina sedamdeset'],
    [680, 'šest stotina osamdeset'],
    [1000, 'jedna hiljada'],
    [1320, 'jedna hiljada tri stotine dvadeset'],
    [2500, 'dvije hiljade pet stotina'],
    [5820, 'pet hiljada osam stotina dvadeset'],
    [9700, 'devet hiljada sedam stotina'],
    [11000, 'jedanaest hiljada'],
    [12000, 'dvanaest hiljada'],
    [21000, 'dvadeset i jedna hiljada'],
    [24000, 'dvadeset i četiri hiljade'],
    [1_000_000, 'jedan milion'],
    [2_500_000, 'dva miliona pet stotina hiljada'],
    [11_000_000, 'jedanaest miliona'],
    [21_000_001, 'dvadeset i jedan milion jedan'],
  ])('%i → %s', (n, words) => {
    expect(integerInWords(n)).toBe(words);
  });

  it('formats as the sample invoice: "šest stotina osamdeset i 00/100 KM"', () => {
    expect(amountInWords(68000)).toBe('šest stotina osamdeset i 00/100 KM');
    expect(amountInWords(80837)).toBe('osam stotina osam i 37/100 KM');
    expect(amountInWords(5)).toBe('nula i 05/100 KM');
  });

  it('is identical to the document for 100.000 random amounts below one million KM', () => {
    let seed = 20261121;
    const random = (): number => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    const mismatches: string[] = [];
    for (let i = 0; i < 100_000; i += 1) {
      const fenings = Math.floor(random() * 100_000_000);
      const expected = documentSlova(fenings / 100);
      const actual = amountInWords(fenings);
      if (actual !== expected && mismatches.length < 5) mismatches.push(`${fenings}: ${actual} ≠ ${expected}`);
    }
    for (const edge of [0, 1, 99, 100, 1000, 100000, 101000, 1100000, 99999999]) {
      if (amountInWords(edge) !== documentSlova(edge / 100)) mismatches.push(`edge ${edge}`);
    }
    expect(mismatches).toEqual([]);
  });

  it('refuses invalid amounts', () => {
    expect(() => amountInWords(-1)).toThrow(MoneyError);
    expect(() => amountInWords(1.5)).toThrow(MoneyError);
    expect(() => integerInWords(1_000_000_000_000_000)).toThrow(MoneyError);
  });
});
