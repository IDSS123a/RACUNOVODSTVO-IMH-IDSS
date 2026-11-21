/**
 * Code 39 barcode of the invoice number (F1 / SPEC C2). The document's encoder (`c39`) knew only digits and
 * silently dropped every other character, so "IMH 004/26" became the digits 00426. This encoder covers the full
 * Code 39 set, so the whole number, e.g. `IMH-004/26`, is encoded and can be scanned back.
 *
 * Each character is 9 elements (bar, space, bar, …, bar), 3 of them wide: '1' = wide, '0' = narrow.
 * Characters are separated by one narrow space; the code starts and ends with '*'.
 */
export const CODE39: Readonly<Record<string, string>> = {
  '0': '000110100', '1': '100100001', '2': '001100001', '3': '101100000', '4': '000110001',
  '5': '100110000', '6': '001110000', '7': '000100101', '8': '100100100', '9': '001100100',
  A: '100001001', B: '001001001', C: '101001000', D: '000011001', E: '100011000',
  F: '001011000', G: '000001101', H: '100001100', I: '001001100', J: '000011100',
  K: '100000011', L: '001000011', M: '101000010', N: '000010011', O: '100010010',
  P: '001010010', Q: '000000111', R: '100000110', S: '001000110', T: '000010110',
  U: '110000001', V: '011000001', W: '111000000', X: '010010001', Y: '110010000',
  Z: '011010000', '-': '010000101', '.': '110000100', ' ': '011000100', $: '010101000',
  '/': '010100010', '+': '010001010', '%': '000101010', '*': '010010100',
};

/** Width of a wide element in narrow units (the document used 3). */
export const WIDE = 3;

export interface Bar {
  /** Left edge, in narrow units from the start. */
  readonly x: number;
  readonly width: number;
}

/**
 * Bars of a Code 39 symbol for `text` (upper-cased; start/stop '*' added).
 * @returns the bars and the total width in narrow units
 * @throws when the text contains a character Code 39 cannot encode
 */
export function code39Bars(text: string): { bars: Bar[]; width: number } {
  const value = text.toUpperCase();
  for (const ch of value) {
    if (ch === '*' || !(ch in CODE39)) throw new Error(`Code 39 ne može kodirati znak „${ch}“`);
  }
  const bars: Bar[] = [];
  let x = 0;
  const symbol = `*${value}*`;
  [...symbol].forEach((ch, index) => {
    const pattern = CODE39[ch] ?? '';
    for (let k = 0; k < 9; k += 1) {
      const width = pattern[k] === '1' ? WIDE : 1;
      if (k % 2 === 0) bars.push({ x, width });
      x += width;
    }
    if (index < symbol.length - 1) x += 1; // inter-character gap
  });
  return { bars, width: x };
}
