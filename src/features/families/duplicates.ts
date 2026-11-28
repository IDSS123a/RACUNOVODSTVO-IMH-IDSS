import { fold } from '@/features/invoices/search';
import type { Child, FamilyDetail, Guardian } from './types';

/**
 * Possible duplicates before a family, parent or child is saved (SPEC registration-validation §B, approved
 * 2026-11-27). A duplicate family or child leads to duplicate invoices, so the operator is warned and decides;
 * records are never merged automatically. Comparison ignores case, accents (č = c, đ = dj …) and extra spaces.
 */

export interface DuplicateMatch {
  readonly familyId: string;
  readonly familyName: string;
  /** Why it may be the same record, in words for the operator (no other data of the found family is shown). */
  readonly reasons: ReadonlyArray<string>;
}

/** A name for comparison: lower case, without accents, single spaces. */
export function nameKey(name: string): string {
  return fold(name).replace(/\s+/g, ' ').trim();
}

function add(matches: Map<string, { familyName: string; reasons: Set<string> }>, family: FamilyDetail, reason: string): void {
  const entry = matches.get(family.family.id) ?? { familyName: family.family.displayName, reasons: new Set<string>() };
  entry.reasons.add(reason);
  matches.set(family.family.id, entry);
}

function result(matches: Map<string, { familyName: string; reasons: Set<string> }>): DuplicateMatch[] {
  return [...matches].map(([familyId, m]) => ({ familyId, familyName: m.familyName, reasons: [...m.reasons] }));
}

/**
 * Other families that may be the same as the family being saved: the same family name, a parent with the same name,
 * or a parent with the same telephone or e-mail. The family itself (same id) is never a match, and two parents of
 * the same family may share a home telephone.
 */
export function familyDuplicates(candidate: { family: { id: string; displayName: string }; guardians: ReadonlyArray<Guardian> }, all: ReadonlyArray<FamilyDetail>): DuplicateMatch[] {
  const matches = new Map<string, { familyName: string; reasons: Set<string> }>();
  const name = nameKey(candidate.family.displayName);
  for (const other of all) {
    if (other.family.id === candidate.family.id) continue;
    if (name !== '' && nameKey(other.family.displayName) === name) add(matches, other, 'isti naziv porodice');
    for (const g of candidate.guardians) {
      for (const o of other.guardians) {
        if (g.fullName.trim() && nameKey(o.fullName) === nameKey(g.fullName)) add(matches, other, `roditelj istog imena (${g.fullName.trim()})`);
        if (g.phone.trim() && o.phone.trim() === g.phone.trim()) add(matches, other, `isti telefon (${g.phone.trim()})`);
        if (g.email.trim() && o.email.trim().toLowerCase() === g.email.trim().toLowerCase()) add(matches, other, `isti e-mail (${g.email.trim()})`);
      }
    }
  }
  return result(matches);
}

/**
 * Children that may be the same as the child being saved.
 * - `blocking`: the same name and date of birth in the SAME family — always a mistake, refused (also by the backend).
 * - `matches`: the same name and date of birth in another family, or the same name in the same family.
 */
export function childDuplicates(child: Child, all: ReadonlyArray<FamilyDetail>): { blocking: string | null; matches: DuplicateMatch[] } {
  const matches = new Map<string, { familyName: string; reasons: Set<string> }>();
  const name = nameKey(`${child.firstName} ${child.lastName}`);
  let blocking: string | null = null;
  for (const family of all) {
    for (const other of family.children) {
      if (other.id === child.id || nameKey(`${other.firstName} ${other.lastName}`) !== name) continue;
      const sameBirth = child.dateOfBirth !== null && other.dateOfBirth === child.dateOfBirth;
      if (family.family.id === child.familyId) {
        if (sameBirth) blocking = `Dijete ${other.firstName} ${other.lastName} s istim datumom rođenja već postoji u ovoj porodici.`;
        else add(matches, family, `dijete istog imena u ovoj porodici (${other.firstName} ${other.lastName})`);
      } else if (sameBirth) {
        add(matches, family, `dijete istog imena i datuma rođenja (${other.firstName} ${other.lastName})`);
      }
    }
  }
  return { blocking, matches: result(matches) };
}
