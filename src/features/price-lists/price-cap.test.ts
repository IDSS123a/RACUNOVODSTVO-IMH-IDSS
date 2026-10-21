import { describe, expect, it } from 'vitest';
import { checkPriceCap, maxIncreaseFor } from './price-cap';

describe('price-increase cap (Program 16/26, BR-20)', () => {
  it('selects the band by the previous price', () => {
    expect(maxIncreaseFor(40000)).toBe(1000);
    expect(maxIncreaseFor(40001)).toBe(500);
    expect(maxIncreaseFor(60000)).toBe(500);
    expect(maxIncreaseFor(60001)).toBe(300);
  });

  it('IMH Toddlers/Preschoolers domestic 680 → 710 exceeds 3 % (max 700,40) but is approved (D16)', () => {
    const result = checkPriceCap(68000, 71000, true);
    expect(result.increaseBp).toBe(441);
    expect(result.maxAllowed).toBe(70040);
    expect(result.status).toBe('EXCEEDED_WITH_APPROVAL');
    expect(checkPriceCap(68000, 71000, false).status).toBe('EXCEEDED');
  });

  it('IDSS Preschoolers domestic 730 → 750 is within the cap', () => {
    const result = checkPriceCap(73000, 75000, false);
    expect(result.increaseBp).toBe(274);
    expect(result.status).toBe('WITHIN_CAP');
  });

  it('IDSS Preschoolers subsequent 580 → 600 is +3,45 % (band 5 % because 580 ≤ 600)', () => {
    const result = checkPriceCap(58000, 60000, false);
    expect(result.increaseBp).toBe(345);
    expect(result.maxIncreaseBp).toBe(500);
    expect(result.status).toBe('WITHIN_CAP');
  });

  it('exact boundary is allowed', () => {
    expect(checkPriceCap(70000, 72100, false).status).toBe('WITHIN_CAP');
    expect(checkPriceCap(70000, 72101, false).status).toBe('EXCEEDED');
  });
});
