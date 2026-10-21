import { describe, expect, it } from 'vitest';
import { PRICE_LIST_SEED } from '@/features/price-lists/seed';
import {
  allowedTransitions,
  buildFamilyPricing,
  canTransition,
  enrolmentProblems,
  guardianProblems,
  isValidIban,
  schoolYearBounds,
} from './domain';
import type { Child, Enrolment, Guardian } from './types';

const FAMILY = '00000000-0000-4000-8000-000000000001';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function child(n: number, dateOfBirth: string, residency: Child['residency'] = 'DOMESTIC'): Child {
  return { id: id(n), familyId: FAMILY, firstName: `Dijete${n}`, lastName: 'Test', dateOfBirth, residency, citizenBih: true, residenceKs: true };
}

function enrolment(n: number, childNo: number, program: Enrolment['program'], status: Enrolment['status'] = 'ACTIVE'): Enrolment {
  return { id: id(100 + n), childId: id(childNo), program, schoolYear: '2026/2027', startsOn: '2026-09-01', endsOn: null, status };
}

function guardian(n: number, isPayer: boolean, iban = ''): Guardian {
  return { id: id(200 + n), familyId: FAMILY, fullName: `Roditelj ${n}`, role: 'MOTHER', email: '', phone: '', iban, isPayer };
}

describe('IBAN (mod-97)', () => {
  it('accepts the institutions\' real IBANs and empty values', () => {
    expect(isValidIban('BA39 1990 4900 5848 7943')).toBe(true);
    expect(isValidIban('BA391994990021809884')).toBe(true);
    expect(isValidIban('')).toBe(true);
  });

  it('rejects wrong check digits, foreign formats and wrong length', () => {
    expect(isValidIban('BA38 1990 4900 5848 7943')).toBe(false);
    expect(isValidIban('DE89370400440532013000')).toBe(false);
    expect(isValidIban('BA39 1990')).toBe(false);
  });
});

describe('guardians', () => {
  it('requires exactly one payer and valid IBANs', () => {
    expect(guardianProblems([])).toHaveLength(1);
    expect(guardianProblems([guardian(1, false)])[0]).toContain('Označite roditelja koji plaća');
    expect(guardianProblems([guardian(1, true), guardian(2, true)])[0]).toContain('Samo jedan');
    expect(guardianProblems([guardian(1, true, 'BA00 0000 0000 0000 0000')])[0]).toContain('IBAN');
    expect(guardianProblems([guardian(1, true, 'BA39 1990 4900 5848 7943'), guardian(2, false)])).toEqual([]);
  });
});

describe('enrolments', () => {
  it('derives school-year bounds', () => {
    expect(schoolYearBounds('2026/2027')).toEqual({ from: '2026-09-01', to: '2027-08-31' });
  });

  it('rejects a second active enrolment of the same child in the same entity and year', () => {
    const first = enrolment(1, 1, 'TODDLERS');
    const second = enrolment(2, 1, 'PRESCHOOLERS');
    expect(enrolmentProblems(second, [first])[0]).toContain('već ima aktivan upis u IMH');
  });

  it('allows the same child in IMH and IDSS, and a new enrolment after withdrawal', () => {
    expect(enrolmentProblems(enrolment(2, 1, 'PRIMARY_1_4'), [enrolment(1, 1, 'IDSS_PRESCHOOLERS')])).toEqual([]);
    expect(enrolmentProblems(enrolment(2, 1, 'PRESCHOOLERS'), [enrolment(1, 1, 'TODDLERS', 'WITHDRAWN')])).toEqual([]);
  });

  it('rejects start dates outside the school year and end before start', () => {
    const outside = { ...enrolment(1, 1, 'TODDLERS'), startsOn: '2026-08-31' };
    expect(enrolmentProblems(outside, [])[0]).toContain('unutar školske godine');
    const backwards = { ...enrolment(1, 1, 'TODDLERS'), startsOn: '2026-10-01', endsOn: '2026-09-15' };
    expect(enrolmentProblems(backwards, [])).toContain('Datum završetka ne može biti prije datuma početka.');
  });

  it('allows only documented status transitions', () => {
    expect(canTransition('AWAITING_ENROLMENT_PAYMENT', 'ACTIVE')).toBe(true);
    expect(canTransition('ACTIVE', 'WITHDRAWN')).toBe(false);
    expect(canTransition('WITHDRAWN', 'ACTIVE')).toBe(false);
    expect(allowedTransitions('COMPLETED')).toEqual([]);
  });
});

describe('family pricing summary (acceptance criterion)', () => {
  const children = [child(1, '2015-04-01'), child(2, '2021-02-01'), child(3, '2023-06-01')];

  it('3 children, 2 in IMH and 1 in IDSS: IMH older full, IMH younger discounted, IDSS full', () => {
    const lines = buildFamilyPricing(
      children,
      [enrolment(1, 1, 'PRIMARY_1_4'), enrolment(2, 2, 'IDSS_PRESCHOOLERS'), enrolment(3, 3, 'TODDLERS')],
      PRICE_LIST_SEED,
      '2026/2027',
    );
    const byChild = new Map(lines.map((line) => [line.childId, line]));
    expect(byChild.get(id(1))).toMatchObject({ entity: 'IDSS', tier: 'FIRST', tuition: 970000, basis: 'ANNUAL' });
    expect(byChild.get(id(2))).toMatchObject({ entity: 'IMH', tier: 'FIRST', tuition: 75000, basis: 'MONTHLY' });
    expect(byChild.get(id(3))).toMatchObject({ entity: 'IMH', tier: 'SUBSEQUENT', tuition: 57000 });
  });

  it('ignores withdrawn enrolments, so the remaining child pays full', () => {
    const lines = buildFamilyPricing(
      children,
      [enrolment(2, 2, 'PRESCHOOLERS', 'WITHDRAWN'), enrolment(3, 3, 'TODDLERS')],
      PRICE_LIST_SEED,
      '2026/2027',
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ tier: 'FIRST', tuition: 71000 });
  });

  it('uses the foreign price column for foreign children', () => {
    const lines = buildFamilyPricing([child(5, '2022-01-01', 'FOREIGN')], [enrolment(5, 5, 'TODDLERS')], PRICE_LIST_SEED, '2026/2027');
    expect(lines[0]?.tuition).toBe(81000);
  });

  it('reports a missing price instead of guessing (M-4)', () => {
    const lines = buildFamilyPricing([child(6, '2022-01-01')], [{ ...enrolment(6, 6, 'TODDLERS'), schoolYear: '2027/2028', startsOn: '2027-09-01' }], PRICE_LIST_SEED, '2027/2028');
    expect(lines[0]).toMatchObject({ tuition: null });
    expect(lines[0]?.problem).toContain('Nema cijene');
  });
});
