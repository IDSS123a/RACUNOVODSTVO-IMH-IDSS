import { describe, expect, it } from 'vitest';
import type { Enrolment, FamilyDetail } from '@/features/families/types';
import { PRICE_LIST_SEED } from '@/features/price-lists/seed';
import { InvoiceDraftSchema } from '@/lib/validation/schemas';
import { finalDrafts } from './monthly';
import { enrolmentPreview, entitiesOfChild, newInvoiceMode } from './new-invoice';
import type { BilledOneTime } from './repository';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const FAMILY = id(1);
const CHILD = id(10);

function enrolment(n: number, program: Enrolment['program'], schoolYear: string, startsOn: string, status: Enrolment['status'] = 'AWAITING_ENROLMENT_PAYMENT'): Enrolment {
  return { id: id(n), childId: CHILD, program, schoolYear, startsOn, endsOn: null, status };
}

function family(enrolments: Enrolment[]): FamilyDetail {
  return {
    family: { id: FAMILY, displayName: 'Aljović', address: 'Džemala Bijedića 160, 71000 Sarajevo' },
    guardians: [{ id: id(2), familyId: FAMILY, fullName: 'Kupac Test', role: 'FATHER', email: '', phone: '', iban: '', isPayer: true }],
    children: [{ id: CHILD, familyId: FAMILY, firstName: 'Zoi', lastName: 'Test', dateOfBirth: '2023-03-03', residency: 'DOMESTIC', citizenBih: true, residenceKs: true, importReview: false }],
    enrolments,
  };
}

describe('„Novi račun“ recognizes what is due (Director, 2026-11-21)', () => {
  it('enrolled for the next school year → enrolment invoice now; attending → monthly; not enrolled → temporary service', () => {
    const next = family([enrolment(20, 'PRESCHOOLERS', '2027/2028', '2027-09-01')]);
    expect(newInvoiceMode(next, CHILD, 'IMH', '2026-11')).toMatchObject({ mode: 'ENROLMENT', enrolment: { id: id(20) } });
    const now = family([enrolment(20, 'PRESCHOOLERS', '2026/2027', '2026-09-01', 'ACTIVE')]);
    expect(newInvoiceMode(now, CHILD, 'IMH', '2026-11')).toMatchObject({ mode: 'MONTHLY' });
    expect(newInvoiceMode(now, CHILD, 'IDSS', '2026-11')).toEqual({ mode: 'MANUAL' });
    expect(newInvoiceMode(family([]), CHILD, 'IMH', '2026-11')).toEqual({ mode: 'MANUAL' });
    const withdrawn = family([enrolment(20, 'PRESCHOOLERS', '2027/2028', '2027-09-01', 'WITHDRAWN')]);
    expect(newInvoiceMode(withdrawn, CHILD, 'IMH', '2026-11')).toEqual({ mode: 'MANUAL' });
    expect(entitiesOfChild(next, CHILD)).toEqual(['IMH']);
  });

  it('the enrolment invoice for the next school year: fee, materials, deposit by the price list, due before the start', () => {
    const detail = family([enrolment(20, 'PRESCHOOLERS', '2027/2028', '2027-09-01')]);
    const enr = detail.enrolments[0];
    if (!enr) throw new Error('fixture');
    // 2027/2028 prices are not in the seed: the 2026/2027 list stands in by moving the enrolment one year back
    const thisYear = family([enrolment(20, 'PRESCHOOLERS', '2026/2027', '2026-09-01')]);
    const e2026 = thisYear.enrolments[0];
    if (!e2026) throw new Error('fixture');
    const preview = enrolmentPreview(thisYear, PRICE_LIST_SEED, [], e2026, [], '2026-06-15');
    expect(preview?.kind).toBe('ENROLMENT_FEES');
    expect(preview?.lines.map((l) => [l.line.itemCode, l.line.amount, l.selected])).toEqual([
      ['ENROLMENT_FEE', 20000, true],
      ['MATERIALS', 30000, true],
      ['DEPOSIT', 71000, true],
    ]);
    expect(preview?.header).toMatchObject({ periodFrom: '2026-09-01', periodTo: '2027-08-31', dueDate: '2026-08-31' });
    const [draft] = finalDrafts(preview ? [preview] : []);
    expect(draft).toMatchObject({ kind: 'ENROLMENT_FEES', total: 121000 });
    expect(InvoiceDraftSchema.safeParse(draft).success).toBe(true);
    expect(enr.schoolYear).toBe('2027/2028');
  });

  it('nothing left to bill → no enrolment invoice', () => {
    const detail = family([enrolment(20, 'PRESCHOOLERS', '2026/2027', '2026-09-01')]);
    const e = detail.enrolments[0];
    if (!e) throw new Error('fixture');
    const billed: BilledOneTime[] = ['ENROLMENT_FEE', 'MATERIALS', 'DEPOSIT'].map((itemCode) => ({
      enrolmentId: e.id, childId: CHILD, entity: 'IMH', itemCode, invoiceNumber: 'IMH-001/26', issueDate: '2026-06-01',
    }));
    expect(enrolmentPreview(detail, PRICE_LIST_SEED, [], e, billed, '2026-06-15')).toBeNull();
  });
});
