import { describe, expect, it } from 'vitest';
import { ChildSchema, EnrolmentSchema } from '@/lib/validation/schemas';
import { bulkItems, bulkRows, lastEntityByChild, programsOf, rowProblems, type BulkRow } from './bulk-enrolment';
import type { FamilyDetail } from './types';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const TODAY = '2026-11-21';

const family: FamilyDetail = {
  family: { id: id(1), displayName: 'Test', address: 'Buka 1' },
  guardians: [],
  children: [
    { id: id(10), familyId: id(1), firstName: 'Uvezena', lastName: 'Test', dateOfBirth: null, residency: 'DOMESTIC', citizenBih: true, residenceKs: true, importReview: true },
    { id: id(11), familyId: id(1), firstName: 'Upisana', lastName: 'Test', dateOfBirth: '2022-01-01', residency: 'DOMESTIC', citizenBih: true, residenceKs: true, importReview: false },
    { id: id(12), familyId: id(1), firstName: 'Lani', lastName: 'Test', dateOfBirth: '2020-05-05', residency: 'FOREIGN', citizenBih: false, residenceKs: true, importReview: false },
  ],
  enrolments: [
    { id: id(20), childId: id(11), program: 'TODDLERS', schoolYear: '2026/2027', startsOn: '2026-09-01', endsOn: null, status: 'ACTIVE' },
    { id: id(21), childId: id(12), program: 'PRESCHOOLERS', schoolYear: '2025/2026', startsOn: '2025-09-01', endsOn: null, status: 'COMPLETED' },
  ],
};

describe('Upis uvezene djece', () => {
  it('lists only children without an enrolment in the school year, with the institution of their latest invoice', () => {
    const last = lastEntityByChild([
      { childId: id(10), entity: 'IDSS', kind: 'OTHER', issueDate: '2025-10-01' },
      { childId: id(10), entity: 'IMH', kind: 'OTHER', issueDate: '2026-10-01' },
      { childId: id(10), entity: 'IDSS', kind: 'CREDIT_NOTE', issueDate: '2026-11-01' },
    ]);
    const rows = bulkRows([family], '2026/2027', last);
    expect(rows.map((r) => [r.child.firstName, r.suggestedEntity, r.dateOfBirth, r.startsOn, r.selected])).toEqual([
      ['Uvezena', 'IMH', '', '2026-09-01', false],
      ['Lani', null, '2020-05-05', '2026-09-01', false],
    ]);
  });

  it('never guesses: program and date of birth must be entered; program must belong to the institution', () => {
    const [row] = bulkRows([family], '2026/2027', new Map([[id(10), 'IMH']]));
    if (!row) throw new Error('fixture');
    expect(rowProblems(row, '2026/2027', TODAY)).toEqual(['odaberite program', 'unesite datum rođenja']);
    const wrong = rowProblems({ ...row, program: 'PRIMARY_1_4', dateOfBirth: '2023-03-03' }, '2026/2027', TODAY);
    expect(wrong[0]).toBe('program ne pripada ustanovi');
    // a 3-year-old in primary school is refused too (Director, 2026-11-22)
    expect(wrong[1]).toContain('3 god.');
    expect(rowProblems({ ...row, dateOfBirth: '1998-01-01' }, '2026/2027', TODAY).join(' ')).toContain('provjerite datum rođenja');
    expect(rowProblems({ ...row, program: 'TODDLERS', dateOfBirth: '2027-01-01' }, '2026/2027', TODAY)).toEqual(['datum rođenja mora biti u prošlosti']);
    expect(rowProblems({ ...row, program: 'PRESCHOOLERS', dateOfBirth: '2023-03-03', startsOn: '2027-09-01' }, '2026/2027', TODAY)[0]).toContain('školske godine');
    expect(rowProblems({ ...row, program: 'PRESCHOOLERS', dateOfBirth: '2023-03-03' }, '2026/2027', TODAY)).toEqual([]);
    expect(programsOf('IMH')).toEqual(['PRESCHOOLERS', 'IDSS_PRESCHOOLERS']); // Toddlers / Preschoolers is one choice
    expect(programsOf('IDSS')).toEqual(['PRIMARY_1_4', 'PRIMARY_5_9']);
  });

  it('saves only ticked, complete rows; the child gets its date of birth and residency, the review flag is cleared', () => {
    const rows = bulkRows([family], '2026/2027', new Map([[id(10), 'IMH']]));
    const done: BulkRow[] = rows.map((r, i) =>
      i === 0 ? { ...r, program: 'PRESCHOOLERS', dateOfBirth: '2023-03-03', startsOn: '2026-12-01', selected: true } : { ...r, selected: true },
    );
    let n = 100;
    const items = bulkItems(done, '2026/2027', TODAY, () => id((n += 1)));
    expect(items).toHaveLength(1); // the second row has no program yet
    const [child, enrolment] = items[0] ?? [];
    expect(child).toMatchObject({ id: id(10), dateOfBirth: '2023-03-03', importReview: false });
    expect(enrolment).toEqual({ id: id(101), childId: id(10), program: 'PRESCHOOLERS', schoolYear: '2026/2027', startsOn: '2026-12-01', endsOn: null, status: 'ACTIVE' });
    expect(ChildSchema.safeParse(child).success && EnrolmentSchema.safeParse(enrolment).success).toBe(true);
  });
});
