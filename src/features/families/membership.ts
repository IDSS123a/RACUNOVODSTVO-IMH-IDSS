import { PROGRAM_ENTITY, type LegalEntityCode, type SchoolYear } from '@/features/price-lists/types';
import { ACTIVE_STATUSES } from './domain';
import type { FamilyDetail } from './types';

/**
 * To which institution a child — and so its family — belongs, for the lists of one institution's flow (Director,
 * 2026-11-21 and 2026-11-22: „u IMH samo IMH, u IDSS samo IDSS … spiskove hirurški precizno podijeliti“).
 * One rule for every list, in this order:
 * 1. an active enrolment in this or a later school year — the institution(s) of those enrolments;
 * 2. otherwise the institution of the child's latest invoice (imported invoices included);
 * 3. otherwise the institution of its latest enrolment of any year and status;
 * 4. otherwise nothing is known (e.g. a child only in the old Excel register, without any invoice): it is in NO
 *    institution's list (Director, 2026-11-22: „hirurški precizno“). Its institution is set in „Dopuna podataka o
 *    djeci“ by choosing the program; from then on it is in exactly one list.
 */
export function institutionsOfChild(
  detail: FamilyDetail,
  childId: string,
  lastInvoiceEntity: ReadonlyMap<string, LegalEntityCode>,
  schoolYear: SchoolYear,
): LegalEntityCode[] {
  const own = detail.enrolments.filter((e) => e.childId === childId);
  const current = new Set(own.filter((e) => ACTIVE_STATUSES.has(e.status) && e.schoolYear >= schoolYear).map((e) => PROGRAM_ENTITY[e.program]));
  if (current.size > 0) return [...current].sort();
  const invoiced = lastInvoiceEntity.get(childId);
  if (invoiced) return [invoiced];
  const latest = [...own].sort((a, b) => b.startsOn.localeCompare(a.startsOn))[0];
  return latest ? [PROGRAM_ENTITY[latest.program]] : [];
}

/** The child is shown in this institution's lists. */
export function childBelongsTo(
  detail: FamilyDetail,
  childId: string,
  entity: LegalEntityCode,
  lastInvoiceEntity: ReadonlyMap<string, LegalEntityCode>,
  schoolYear: SchoolYear,
): boolean {
  return institutionsOfChild(detail, childId, lastInvoiceEntity, schoolYear).includes(entity);
}

/** The family is shown when at least one of its children belongs to the institution. */
export function familyBelongsTo(
  detail: FamilyDetail,
  entity: LegalEntityCode,
  lastInvoiceEntity: ReadonlyMap<string, LegalEntityCode>,
  schoolYear: SchoolYear,
): boolean {
  return detail.children.some((c) => childBelongsTo(detail, c.id, entity, lastInvoiceEntity, schoolYear));
}
