import { describe, expect, it } from 'vitest';
import type { Enrolment, FamilyDetail } from '@/features/families/types';
import { PRICE_LIST_SEED } from '@/features/price-lists/seed';
import { InvoiceDraftSchema } from '@/lib/validation/schemas';
import { buildImhMonthlyInvoices } from './domain';
import { extraServiceLine, familyPreview, finalDrafts, previewProblem, previewTotal, type PreviewInvoice } from './monthly';
import { buildIdssMonthlyInvoices, type PaymentPlan } from './plans';
import type { BilledOneTime } from './repository';
import type { BillingMonth } from './types';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const FAMILY = id(1);
const OLDER = id(10);
const YOUNGER = id(11);
const PUPIL = id(12);

function enrolment(n: number, childId: string, program: Enrolment['program'], startsOn = '2026-09-01', schoolYear = '2026/2027', status: Enrolment['status'] = 'ACTIVE'): Enrolment {
  return { id: id(n), childId, program, schoolYear, startsOn, endsOn: null, status };
}

function family(enrolments: Enrolment[]): FamilyDetail {
  return {
    family: { id: FAMILY, displayName: 'Test', address: 'Buka 1' },
    guardians: [{ id: id(2), familyId: FAMILY, fullName: 'Majka Test', role: 'MOTHER', email: '', phone: '', iban: '', isPayer: true }],
    children: [
      { id: OLDER, familyId: FAMILY, firstName: 'Starija', lastName: 'Test', dateOfBirth: '2021-01-01', residency: 'DOMESTIC', citizenBih: true, residenceKs: true, importReview: false },
      { id: YOUNGER, familyId: FAMILY, firstName: 'Mlađa', lastName: 'Test', dateOfBirth: '2023-01-01', residency: 'DOMESTIC', citizenBih: true, residenceKs: true, importReview: false },
      { id: PUPIL, familyId: FAMILY, firstName: 'Školarac', lastName: 'Test', dateOfBirth: '2019-01-01', residency: 'DOMESTIC', citizenBih: true, residenceKs: true, importReview: false },
    ],
    enrolments,
  };
}

const IDSS_CONTEXT = { priceItems: PRICE_LIST_SEED, rules: null, breakfast: new Set<string>() };

function preview(detail: FamilyDetail, month: BillingMonth, plans: PaymentPlan[] = [], billed: BilledOneTime[] = []) {
  const issueDate = `${month}-01`;
  const imh = buildImhMonthlyInvoices(detail, PRICE_LIST_SEED, [], month, issueDate);
  const idss = buildIdssMonthlyInvoices(detail, plans, IDSS_CONTEXT, month, issueDate);
  return familyPreview(detail, imh, idss.drafts, PRICE_LIST_SEED, plans, billed, month, issueDate);
}

const items = (p: PreviewInvoice | undefined) => (p ? p.lines.map((l) => [l.line.itemCode, l.line.amount, l.selected]) : []);

function plan(enrolmentId: string, instalments: number, invoicedUpTo = 0): PaymentPlan {
  const amount = 97000;
  return {
    id: `plan-${enrolmentId}`,
    enrolmentId,
    childId: PUPIL,
    itemCode: 'TUITION',
    instalments,
    total: amount * instalments,
    items: Array.from({ length: instalments }, (_, i) => {
      const m = ((8 + i) % 12) + 1;
      const y = m >= 9 ? 2026 : 2027;
      return { sequence: i + 1, dueDate: `${y}-${String(m).padStart(2, '0')}-05`, amount, invoiceId: i < invoicedUpTo ? `inv${i}` : null };
    }),
  };
}

describe('one invoice per child (Director, 2026-11-21)', () => {
  it('a new IMH child starting in December: tuition, enrolment fee, materials and deposit on ONE invoice', () => {
    const { previews, problems } = preview(family([enrolment(20, YOUNGER, 'TODDLERS', '2026-12-01')]), '2026-12');
    expect(problems).toEqual([]);
    expect(previews).toHaveLength(1);
    expect(items(previews[0])).toEqual([
      ['TUITION', 71000, true],
      ['ENROLMENT_FEE', 20000, true],
      ['MATERIALS', 30000, true],
      ['DEPOSIT', 71000, true],
    ]);
    const drafts = finalDrafts(previews);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ kind: 'MONTHLY', total: 192000, childId: YOUNGER, periodFrom: '2026-12-01' });
    expect(InvoiceDraftSchema.safeParse(drafts[0]).success).toBe(true);
  });

  it('siblings: each child its own invoice; the younger pays the subsequent tuition and deposit', () => {
    const { previews } = preview(family([enrolment(20, OLDER, 'PRESCHOOLERS'), enrolment(21, YOUNGER, 'TODDLERS')]), '2026-09');
    expect(previews.map((p) => [p.header.childId, previewTotal(p)])).toEqual([
      [OLDER, 71000 + 20000 + 30000 + 71000],
      [YOUNGER, 57000 + 20000 + 30000 + 57000],
    ]);
  });

  it('items already billed for this enrolment are not proposed again; until billed they are proposed every month', () => {
    const detail = family([enrolment(20, YOUNGER, 'TODDLERS')]);
    const billed: BilledOneTime[] = [
      { enrolmentId: id(20), childId: YOUNGER, entity: 'IMH', itemCode: 'ENROLMENT_FEE', invoiceNumber: 'IMH-001/26', issueDate: '2026-09-01' },
      { enrolmentId: id(20), childId: YOUNGER, entity: 'IMH', itemCode: 'MATERIALS', invoiceNumber: 'IMH-001/26', issueDate: '2026-09-01' },
    ];
    // the deposit was left out in September by the operator: October proposes it again
    expect(items(preview(detail, '2026-10', [], billed).previews[0])).toEqual([['TUITION', 71000, true], ['DEPOSIT', 71000, true]]);
  });

  it('a continuing child pays only materials (fee valid until withdrawal, deposit carried over — BR-9)', () => {
    const detail = family([enrolment(19, YOUNGER, 'TODDLERS', '2025-09-01', '2025/2026', 'COMPLETED'), enrolment(20, YOUNGER, 'PRESCHOOLERS')]);
    const p = preview(detail, '2026-09').previews[0];
    expect(items(p)).toEqual([['TUITION', 71000, true], ['MATERIALS', 30000, true]]);
    expect(p?.notes.join(' ')).toContain('depozit se prenosi');
  });

  it('an item on an imported invoice of the old workbook is proposed but not selected, naming that invoice', () => {
    const billed: BilledOneTime[] = [{ enrolmentId: null, childId: YOUNGER, entity: 'IMH', itemCode: 'ENROLMENT_FEE', invoiceNumber: 'IMH 812/26', issueDate: '2026-06-10' }];
    const p = preview(family([enrolment(20, YOUNGER, 'TODDLERS')]), '2026-09', [], billed).previews[0];
    const fee = p?.lines.find((l) => l.line.itemCode === 'ENROLMENT_FEE');
    expect(fee?.selected).toBe(false);
    expect(fee?.note).toContain('IMH 812/26');
    expect(finalDrafts(p ? [p] : [])[0]?.lines.map((l) => l.itemCode)).toEqual(['TUITION', 'MATERIALS', 'DEPOSIT']);
  });

  it('IDSS: enrolment fee on the instalment invoice; deposit proposed only with a plan of 2+ instalments and not selected', () => {
    const detail = family([enrolment(22, PUPIL, 'PRIMARY_1_4')]);
    const p = preview(detail, '2026-09', [plan(id(22), 10)]).previews[0];
    expect(p?.kind).toBe('INSTALMENT');
    expect(items(p)).toEqual([['TUITION', 97000, true], ['ENROLMENT_FEE', 100000, true], ['DEPOSIT', 150000, false]]);
    expect(p?.lines.find((l) => l.line.itemCode === 'DEPOSIT')?.note).toContain('odluku škole');
    const one = preview(detail, '2026-09', [plan(id(22), 1)]).previews[0];
    expect(items(one).map((i) => i[0])).toEqual(['TUITION', 'ENROLMENT_FEE']);
  });

  it('IDSS pupil with no instalment due this month still gets an invoice for the unbilled enrolment fee', () => {
    const detail = family([enrolment(22, PUPIL, 'PRIMARY_1_4')]);
    // all ten instalments already invoiced; the fee was left out until now
    const p = preview(detail, '2026-10', [plan(id(22), 10, 10)]).previews[0];
    expect(p?.kind).toBe('INSTALMENT');
    expect(items(p).map((i) => i[0])).toEqual(['ENROLMENT_FEE', 'DEPOSIT']);
    expect(p?.header.periodFrom).toBe('2026-10-01');
  });

  it('the operator decides: lines and invoices left out are not issued; an excluded instalment is not marked invoiced', () => {
    const detail = family([enrolment(22, PUPIL, 'PRIMARY_1_4')]);
    const p = preview(detail, '2026-09', [plan(id(22), 10)]).previews[0];
    if (!p) throw new Error('fixture');
    const withoutTuition: PreviewInvoice = { ...p, lines: p.lines.map((l) => (l.line.itemCode === 'TUITION' ? { ...l, selected: false } : l)) };
    const [draft] = finalDrafts([withoutTuition]);
    expect(draft?.lines.map((l) => l.itemCode)).toEqual(['ENROLMENT_FEE']);
    expect(draft?.planItems).toEqual([]);
    expect(finalDrafts([p])[0]?.planItems).toEqual([{ planId: `plan-${id(22)}`, sequence: 1 }]);
    expect(finalDrafts([{ ...p, included: false }])).toEqual([]);
    const nothing: PreviewInvoice = { ...p, lines: p.lines.map((l) => ({ ...l, selected: false })) };
    expect(previewProblem(nothing)).toBe('nijedna stavka nije odabrana');
    expect(finalDrafts([nothing])).toEqual([]);
  });

  it('an extra service on the monthly invoice needs its basis and keeps the enrolment of the child', () => {
    const p = preview(family([enrolment(20, YOUNGER, 'TODDLERS', '2026-12-01')]), '2026-12').previews[0];
    if (!p) throw new Error('fixture');
    const withTrip: PreviewInvoice = { ...p, lines: [...p.lines, extraServiceLine(p, { description: ' Izlet ', unit: 'kom', quantity: 2, unitPrice: 1500 })] };
    expect(previewProblem(withTrip)).toBe('unesite osnov za uslugu van cjenovnika');
    expect(finalDrafts([withTrip])).toEqual([]);
    const [draft] = finalDrafts([{ ...withTrip, reason: ' Obavijest o izletu ' }]);
    expect(draft?.reason).toBe('Obavijest o izletu');
    expect(draft?.lines.at(-1)).toMatchObject({ itemCode: 'OTHER', description: 'Izlet', enrolmentId: id(20), program: 'TODDLERS', amount: 3000, quantity: 2, unit: 'kom' });
    expect(draft?.total).toBe(192000 + 3000);
    expect(InvoiceDraftSchema.safeParse(draft).success).toBe(true);
  });
});
