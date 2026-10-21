import { describe, expect, it } from 'vitest';
import { MoneyError } from './money';
import { amountInWords, integerInWords } from './amount-in-words';

describe('amount in words', () => {
  it.each([
    [0, 'nula'],
    [1, 'jedna'],
    [2, 'dvije'],
    [11, 'jedanaest'],
    [21, 'dvadeset jedna'],
    [60, 'šezdeset'],
    [100, 'sto'],
    [222, 'dvjesta dvadeset dvije'],
    [570, 'petsto sedamdeset'],
    [1000, 'hiljadu'],
    [1320, 'hiljadu trista dvadeset'],
    [2500, 'dvije hiljade petsto'],
    [5820, 'pet hiljada osamsto dvadeset'],
    [9700, 'devet hiljada sedamsto'],
    [12000, 'dvanaest hiljada'],
    [21000, 'dvadeset jedna hiljada'],
    [24000, 'dvadeset četiri hiljade'],
    [1_000_000, 'milion'],
    [2_500_000, 'dva miliona petsto hiljada'],
  ])('%i → %s', (n, words) => {
    expect(integerInWords(n)).toBe(words);
  });

  it('formats KM and fenings', () => {
    expect(amountInWords(132000)).toBe('hiljadu trista dvadeset KM i 00/100');
    expect(amountInWords(80837)).toBe('osamsto osam KM i 37/100');
    expect(amountInWords(5)).toBe('nula KM i 05/100');
  });

  it('refuses invalid amounts', () => {
    expect(() => amountInWords(-1)).toThrow(MoneyError);
    expect(() => amountInWords(1.5)).toThrow(MoneyError);
    expect(() => integerInWords(1_000_000_000)).toThrow(MoneyError);
  });
});
