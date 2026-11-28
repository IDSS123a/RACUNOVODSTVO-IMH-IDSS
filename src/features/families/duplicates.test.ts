import { describe, expect, it } from 'vitest';
import { childDuplicates, familyDuplicates } from './duplicates';
import type { Child, FamilyDetail, Guardian } from './types';

const guardian = (familyId: string, fullName: string, phone = '', email = ''): Guardian => ({
  id: `${familyId}-${fullName}`, familyId, fullName, role: 'MOTHER', email, phone, iban: '', isPayer: true,
});
const child = (id: string, familyId: string, firstName: string, lastName: string, dateOfBirth: string | null): Child => ({
  id, familyId, firstName, lastName, dateOfBirth, residency: 'DOMESTIC', citizenBih: true, residenceKs: true, importReview: false,
});
const family = (id: string, displayName: string, guardians: Guardian[], children: Child[] = []): FamilyDetail => ({
  family: { id, displayName, address: '' }, guardians, children, enrolments: [],
});

// invented names only (BR-22)
const existing = [
  family('f1', 'Begović', [guardian('f1', 'Amir Begović', '+387 61 234 567', 'amir@example.ba')], [child('c1', 'f1', 'Lejla', 'Begović', '2022-05-10')]),
  family('f2', 'Hodžić', [guardian('f2', 'Selma Hodžić', '+387 33 562 114')]),
];

describe('possible duplicates before saving (SPEC registration-validation §B)', () => {
  it('the proposal example: „Amir Begović“, „Amir Begovic“ and „AMIR BEGOVIĆ“ are one possible duplicate', () => {
    for (const typed of ['Amir Begović', 'Amir Begovic', 'AMIR BEGOVIĆ', '  amir   begović ']) {
      const found = familyDuplicates({ family: { id: 'new', displayName: 'Nova' }, guardians: [guardian('new', typed)] }, existing);
      expect(found.map((m) => m.familyId), typed).toEqual(['f1']);
      expect(found[0]?.reasons[0]).toContain('roditelj istog imena');
    }
  });

  it('the same family name, telephone or e-mail is reported with its reason; nothing for a different family', () => {
    const byName = familyDuplicates({ family: { id: 'new', displayName: 'Begovic' }, guardians: [] }, existing);
    expect(byName[0]?.reasons).toEqual(['isti naziv porodice']);
    const byPhone = familyDuplicates({ family: { id: 'new', displayName: 'Kovač' }, guardians: [guardian('new', 'Ana Kovač', '+387 33 562 114')] }, existing);
    expect(byPhone.map((m) => [m.familyId, m.reasons])).toEqual([['f2', ['isti telefon (+387 33 562 114)']]]);
    const byMail = familyDuplicates({ family: { id: 'new', displayName: 'Kovač' }, guardians: [guardian('new', 'Ana Kovač', '', 'AMIR@example.ba')] }, existing);
    expect(byMail[0]?.familyId).toBe('f1');
    expect(familyDuplicates({ family: { id: 'new', displayName: 'Kovač' }, guardians: [guardian('new', 'Ana Kovač', '+387 61 999 888')] }, existing)).toEqual([]);
  });

  it('editing a family never matches itself, and its two parents may share a home telephone', () => {
    const self = existing[0];
    if (!self) throw new Error('fixture');
    const withSecond = { family: self.family, guardians: [...self.guardians, guardian('f1', 'Haris Begović', '+387 61 234 567')] };
    expect(familyDuplicates(withSecond, existing)).toEqual([]);
  });

  it('a child: the same name and birth date in the same family is blocked; in another family it is a warning', () => {
    const twin = childDuplicates(child('new', 'f1', 'Lejla', 'Begovic', '2022-05-10'), existing);
    expect(twin.blocking).toContain('već postoji u ovoj porodici');
    const elsewhere = childDuplicates(child('new', 'f2', 'LEJLA', 'BEGOVIĆ', '2022-05-10'), existing);
    expect(elsewhere.blocking).toBeNull();
    expect(elsewhere.matches[0]?.reasons[0]).toContain('istog imena i datuma rođenja');
    const sameNameOtherBirth = childDuplicates(child('new', 'f1', 'Lejla', 'Begović', '2024-01-01'), existing);
    expect(sameNameOtherBirth.blocking).toBeNull();
    expect(sameNameOtherBirth.matches[0]?.reasons[0]).toContain('istog imena u ovoj porodici');
    expect(childDuplicates(child('c1', 'f1', 'Lejla', 'Begović', '2022-05-10'), existing)).toEqual({ blocking: null, matches: [] }); // itself
  });
});
