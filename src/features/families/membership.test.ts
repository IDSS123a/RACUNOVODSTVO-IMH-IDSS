import { describe, expect, it } from 'vitest';
import type { LegalEntityCode } from '@/features/price-lists/types';
import { childBelongsTo, familyBelongsTo, institutionsOfChild } from './membership';
import type { Enrolment, FamilyDetail } from './types';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const FAMILY = id(1);
const A = id(10);
const B = id(11);
const YEAR = '2026/2027';

function enrolment(n: number, childId: string, program: Enrolment['program'], schoolYear: string, status: Enrolment['status'] = 'ACTIVE'): Enrolment {
  return { id: id(n), childId, program, schoolYear, startsOn: `${schoolYear.slice(0, 4)}-09-01`, endsOn: null, status };
}

function family(childIds: string[], enrolments: Enrolment[]): FamilyDetail {
  return {
    family: { id: FAMILY, displayName: 'Test', address: '' },
    guardians: [],
    children: childIds.map((c) => ({ id: c, familyId: FAMILY, firstName: 'Dijete', lastName: 'Test', dateOfBirth: '2018-01-01', residency: 'DOMESTIC', citizenBih: true, residenceKs: true, importReview: false })),
    enrolments,
  };
}

const none = new Map<string, LegalEntityCode>();

describe('every list of a flow holds only its institution (Director, 2026-11-22)', () => {
  it('a pupil who attended only IDSS is never in IMH — by enrolment, by invoice, or by an old enrolment', () => {
    const enrolled = family([A], [enrolment(20, A, 'PRIMARY_1_4', YEAR)]);
    expect(institutionsOfChild(enrolled, A, none, YEAR)).toEqual(['IDSS']);
    expect(childBelongsTo(enrolled, A, 'IMH', none, YEAR)).toBe(false);
    expect(familyBelongsTo(enrolled, 'IMH', none, YEAR)).toBe(false);
    expect(familyBelongsTo(enrolled, 'IDSS', none, YEAR)).toBe(true);

    // imported: no enrolment in the application, only IDSS invoices
    const imported = family([A], []);
    expect(familyBelongsTo(imported, 'IMH', new Map([[A, 'IDSS']]), YEAR)).toBe(false);
    // only an old IDSS enrolment, finished
    const old = family([A], [enrolment(20, A, 'PRIMARY_1_4', '2024/2025', 'COMPLETED')]);
    expect(familyBelongsTo(old, 'IMH', none, YEAR)).toBe(false);
  });

  it('the current enrolment wins over an older invoice: IMH Preschoolers who moved to IDSS are in IDSS', () => {
    const moved = family([A], [enrolment(20, A, 'PRIMARY_1_4', YEAR)]);
    expect(institutionsOfChild(moved, A, new Map([[A, 'IMH']]), YEAR)).toEqual(['IDSS']);
  });

  it('siblings in both institutions: the family is in both, each child only in its own', () => {
    const detail = family([A, B], [enrolment(20, A, 'PRESCHOOLERS', YEAR), enrolment(21, B, 'PRIMARY_5_9', YEAR)]);
    expect(familyBelongsTo(detail, 'IMH', none, YEAR) && familyBelongsTo(detail, 'IDSS', none, YEAR)).toBe(true);
    expect(childBelongsTo(detail, A, 'IDSS', none, YEAR)).toBe(false);
    expect(childBelongsTo(detail, B, 'IMH', none, YEAR)).toBe(false);
  });

  it('a child whose institution is not known (only in the old register: no enrolment, no invoice) is in neither list', () => {
    const unknown = family([A], []);
    expect(institutionsOfChild(unknown, A, none, YEAR)).toEqual([]);
    expect(childBelongsTo(unknown, A, 'IMH', none, YEAR) || childBelongsTo(unknown, A, 'IDSS', none, YEAR)).toBe(false);
    expect(familyBelongsTo(unknown, 'IMH', none, YEAR) || familyBelongsTo(unknown, 'IDSS', none, YEAR)).toBe(false);
    expect(familyBelongsTo(family([], []), 'IMH', none, YEAR)).toBe(false);
    // once the program is chosen in „Dopuna podataka o djeci“, the child is in exactly one list
    const assigned = family([A], [enrolment(20, A, 'PRIMARY_1_4', YEAR, 'AWAITING_ENROLMENT_PAYMENT')]);
    expect([childBelongsTo(assigned, A, 'IMH', none, YEAR), childBelongsTo(assigned, A, 'IDSS', none, YEAR)]).toEqual([false, true]);
  });
});
