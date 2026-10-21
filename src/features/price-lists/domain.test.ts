import { describe, expect, it } from 'vitest';
import { buildPriceCapRows, buildPriceTable, previousSchoolYear } from './domain';
import { PRICE_LIST_SEED } from './seed';

describe('price table view-model', () => {
  it('merges domestic and foreign prices and keeps entities apart', () => {
    const imh = buildPriceTable(PRICE_LIST_SEED, '2026/2027', 'IMH');
    expect([...imh.keys()]).toEqual(['TODDLERS', 'PRESCHOOLERS', 'IDSS_PRESCHOOLERS']);
    const toddlers = imh.get('TODDLERS') ?? [];
    const first = toddlers.find((row) => row.item === 'TUITION' && row.tier === 'FIRST');
    expect(first?.domestic).toBe(71000);
    expect(first?.foreign).toBe(81000);
    expect(toddlers[0]?.item).toBe('TUITION');

    const idss = buildPriceTable(PRICE_LIST_SEED, '2026/2027', 'IDSS');
    expect([...idss.keys()]).toEqual(['PRIMARY_1_4', 'PRIMARY_5_9']);
  });
});

describe('price-cap rows', () => {
  it('derives the previous school year', () => {
    expect(previousSchoolYear('2026/2027')).toBe('2025/2026');
  });

  it('flags 680 → 710 and keeps the rest within the cap', () => {
    const rows = buildPriceCapRows(PRICE_LIST_SEED, '2026/2027', true);
    expect(rows).toHaveLength(6);
    const toddlersFirst = rows.find((row) => row.program === 'TODDLERS' && row.tier === 'FIRST');
    expect(toddlersFirst?.status).toBe('EXCEEDED_WITH_APPROVAL');
    const idssFirst = rows.find((row) => row.program === 'IDSS_PRESCHOOLERS' && row.tier === 'FIRST');
    expect(idssFirst?.status).toBe('WITHIN_CAP');
  });

  it('returns nothing without a previous year', () => {
    expect(buildPriceCapRows(PRICE_LIST_SEED, '2025/2026', false)).toEqual([]);
  });
});
