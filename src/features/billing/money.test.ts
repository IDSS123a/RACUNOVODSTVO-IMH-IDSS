import { describe, expect, it } from 'vitest';
import {
  applyDiscount,
  divideRounded,
  formatKM,
  formatPercent,
  kmToFenings,
  MoneyError,
  percentOf,
  prorate,
  sum,
} from './money';

describe('divideRounded — half away from zero', () => {
  it('rounds .5 up for positives and down for negatives', () => {
    expect(divideRounded(5, 2)).toBe(3);
    expect(divideRounded(-5, 2)).toBe(-3);
    expect(divideRounded(4, 2)).toBe(2);
    expect(divideRounded(1, 3)).toBe(0);
    expect(divideRounded(2, 3)).toBe(1);
  });

  it('rejects non-integer input and non-positive denominators', () => {
    expect(() => divideRounded(1.5, 2)).toThrow(MoneyError);
    expect(() => divideRounded(1, 0)).toThrow(MoneyError);
  });
});

describe('kmToFenings', () => {
  it('parses bs-BA and plain notations', () => {
    expect(kmToFenings('1.234,56')).toBe(123456);
    expect(kmToFenings('1234.56')).toBe(123456);
    expect(kmToFenings('824,5')).toBe(82450);
    expect(kmToFenings(710)).toBe(71000);
    expect(kmToFenings('9.700,00 KM')).toBe(970000);
  });

  it('rejects more than two decimals and garbage', () => {
    expect(() => kmToFenings('1,005')).toThrow(MoneyError);
    expect(() => kmToFenings('abc')).toThrow(MoneyError);
  });
});

describe('percentages — the legacy app truncated 12,5 % to 13 %', () => {
  it('applies 12,5 % exactly: 710 KM → 621,25 KM', () => {
    expect(applyDiscount(71000, 1250)).toBe(62125);
  });

  it('applies 7,5 % exactly and rounds per line: 824,50 KM → 762,66 KM', () => {
    // 82450 × 0,925 = 76266,25 → 76266
    expect(applyDiscount(82450, 750)).toBe(76266);
  });

  it('three lines of 824,50 KM at 7,5 % sum to the sum of rounded lines (2.287,98 KM)', () => {
    const line = applyDiscount(82450, 750);
    expect(sum([line, line, line])).toBe(228798);
  });

  it('rounds the x,xx5 case half away from zero', () => {
    // 1103,00 × 0,85 = 937,55 exactly (floating point would give 937,5499…)
    expect(applyDiscount(110300, 1500)).toBe(93755);
    // 11.970 × 0,85 = 10.174,50
    expect(applyDiscount(1197000, 1500)).toBe(1017450);
    expect(percentOf(1, 5000)).toBe(1);
  });

  it('refuses discounts outside 0–100 %', () => {
    expect(() => applyDiscount(1000, -1)).toThrow(MoneyError);
    expect(() => applyDiscount(1000, 10001)).toThrow(MoneyError);
  });
});

describe('prorate', () => {
  it('IDSS January start: 9.700 × 6 / 10 = 5.820 KM', () => {
    expect(prorate(970000, 6, 10)).toBe(582000);
  });

  it('refuses parts outside the whole', () => {
    expect(() => prorate(1000, 11, 10)).toThrow(MoneyError);
  });
});

describe('formatting', () => {
  it('formats KM in bs-BA style', () => {
    expect(formatKM(123456)).toBe('1.234,56 KM');
    expect(formatKM(71000)).toBe('710,00 KM');
    expect(formatKM(1197000)).toBe('11.970,00 KM');
    expect(formatKM(-50)).toBe('-0,50 KM');
  });

  it('formats percentages without truncation', () => {
    expect(formatPercent(1250)).toBe('12,5 %');
    expect(formatPercent(2000)).toBe('20 %');
    expect(formatPercent(441)).toBe('4,41 %');
  });
});
