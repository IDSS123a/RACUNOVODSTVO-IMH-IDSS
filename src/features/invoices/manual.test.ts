import { describe, expect, it } from 'vitest';
import type { Enrolment, FamilyDetail } from '@/features/families/types';
import { InvoiceDraftSchema } from '@/lib/validation/schemas';
import { buildManualInvoice, countsAsMonthlyBilled, parsePrice, parseQuantity, rowTotal, type ManualInvoiceInput } from './manual';
import { invoiceRecap } from './recap';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const FAMILY = id(1);
const IMH_CHILD = id(10);
const IDSS_CHILD = id(12);

function enrolment(n: number, childId: string, program: Enrolment['program'], status: Enrolment['status'] = 'ACTIVE', schoolYear = '2026/2027'): Enrolment {
  return { id: id(n), childId, program, schoolYear, startsOn: `${schoolYear.slice(0, 4)}-09-01`, endsOn: null, status };
}

/** By default the „IMH child“ is NOT enrolled in IMH (e.g. it attends only the summer school); the other child is an IDSS pupil. */
function family(enrolments: Enrolment[] = [enrolment(22, IDSS_CHILD, 'PRIMARY_1_4')], address = 'Buka 1'): FamilyDetail {
  return {
    family: { id: FAMILY, displayName: 'Test', address },
    guardians: [{ id: id(2), familyId: FAMILY, fullName: 'Majka Test', role: 'MOTHER', email: '', phone: '', iban: '', isPayer: true }],
    children: [
      { id: IMH_CHILD, familyId: FAMILY, firstName: 'Mlađa', lastName: 'Test', dateOfBirth: '2023-01-01', residency: 'DOMESTIC', citizenBih: true, residenceKs: true, importReview: false },
      { id: IDSS_CHILD, familyId: FAMILY, firstName: 'Školarac', lastName: 'Test', dateOfBirth: '2019-01-01', residency: 'FOREIGN', citizenBih: false, residenceKs: true, importReview: false },
    ],
    enrolments,
  };
}

const input = (over: Partial<ManualInvoiceInput> = {}): ManualInvoiceInput => ({
  entity: 'IMH',
  childId: IMH_CHILD,
  month: '2027-07',
  issueDate: '2027-06-20',
  dueDate: '2027-07-05',
  reason: 'Obavijest o ljetnoj školi 2027',
  rows: [
    { description: 'Ljetna škola — sedmica', unit: 'srv', quantity: '3', unitPrice: '150,50' },
    { description: '', unit: 'srv', quantity: '', unitPrice: '' },
  ],
  ...over,
});

const errorsOf = (r: ReturnType<typeof buildManualInvoice>) => (r.ok ? [] : r.errors);

describe('manual invoice (F2)', () => {
  it('builds an IMH draft for a child not enrolled in IMH: quantity × unit price, month period, basis, no enrolment', () => {
    const r = buildManualInvoice(family(), input());
    if (!r.ok) throw new Error(r.errors.join('; '));
    expect(r.draft).toMatchObject({
      entity: 'IMH', childId: IMH_CHILD, childName: 'Mlađa Test', buyerName: 'Majka Test', buyerAddress: 'Buka 1',
      periodFrom: '2027-07-01', periodTo: '2027-07-31', total: 45150, reason: 'Obavijest o ljetnoj školi 2027',
    });
    expect(r.draft.lines).toEqual([
      { itemCode: 'OTHER', description: 'Ljetna škola — sedmica', childId: IMH_CHILD, enrolmentId: '', program: '', listAmount: 45150, boardDecisionId: null, amount: 45150, quantity: 3, unit: 'srv' },
    ]);
    // the payload the backend receives passes the IPC schema unchanged
    expect(InvoiceDraftSchema.safeParse({ ...r.draft, id: id(99), kind: 'OTHER', lines: [...r.draft.lines], planItems: [] }).success).toBe(true);
  });

  it('Director 2026-11-21 (DEFINICIJA): other services may go to ANY child, enrolled or not, on their own invoice', () => {
    const enrolledPupil = buildManualInvoice(family(), input({ entity: 'IDSS', childId: IDSS_CHILD, month: '2027-02' }));
    expect(enrolledPupil.ok).toBe(true);
    if (enrolledPupil.ok) expect(enrolledPupil.draft.lines.every((l) => l.enrolmentId === '' && l.program === '')).toBe(true);
    expect(buildManualInvoice(family([enrolment(20, IMH_CHILD, 'TODDLERS')]), input()).ok).toBe(true);
    expect(buildManualInvoice(family([enrolment(20, IMH_CHILD, 'TODDLERS', 'WITHDRAWN')]), input()).ok).toBe(true);
  });

  it('every required field has the document message (M5)', () => {
    const errors = errorsOf(buildManualInvoice(family([], ''), { entity: 'IMH', childId: '', month: '', issueDate: '', dueDate: '', reason: ' ', rows: [] }));
    expect(errors).toEqual([
      'Odaberite dijete.',
      'Adresa kupca ne može biti prazna — unesite je u kartici porodice.',
      'Odaberite obračunski mjesec.',
      'Unesite datum izdavanja računa.',
      'Unesite rok plaćanja računa.',
      'Unesite osnov računa (odluka, ugovor ili obavijest).',
      'Unesite barem jednu ispravnu stavku na račun (naziv, količina > 0 i cijena).',
    ]);
    expect(errorsOf(buildManualInvoice(family(), input({ dueDate: '2027-06-19' })))).toEqual(['Rok plaćanja ne može biti prije datuma izdavanja.']);
  });

  it('row validations: name, whole quantity 1–999, price ≥ 0 with at most two decimals; empty rows are ignored', () => {
    const row = (quantity: string, unitPrice: string, description = 'Usluga') => input({ rows: [{ description, unit: 'kom', quantity, unitPrice }] });
    expect(errorsOf(buildManualInvoice(family(), row('1', '10', ' ')))).toEqual(['Red 1: Unesite naziv usluge/stavke.']);
    for (const q of ['0', '-1', '1,5', '1000', 'x', '']) expect(errorsOf(buildManualInvoice(family(), row(q, '10')))[0]).toContain('Red 1: Količina');
    for (const p of ['-1', '1,234', 'abc', '']) expect(errorsOf(buildManualInvoice(family(), row('1', p)))[0]).toContain('Red 1: Cijena');
    expect(errorsOf(buildManualInvoice(family(), row('2', '0')))).toEqual(['Ukupan iznos računa mora biti veći od 0 KM.']);
  });

  it('a family without a buyer cannot be invoiced (BR-24)', () => {
    const detail = family();
    expect(errorsOf(buildManualInvoice({ ...detail, guardians: [] }, input()))[0]).toContain('nema kupca na računu');
  });

  it('the monthly bulk is not blocked by a manual invoice, but still by monthly, enrolment and imported ones', () => {
    const base = { status: 'ISSUED', childId: IMH_CHILD };
    expect(countsAsMonthlyBilled({ ...base, kind: 'OTHER', source: 'APP' })).toBe(false);
    expect(countsAsMonthlyBilled({ ...base, kind: 'OTHER', source: 'LEGACY' })).toBe(true);
    expect(countsAsMonthlyBilled({ ...base, kind: 'MONTHLY', source: 'APP' })).toBe(true);
    expect(countsAsMonthlyBilled({ ...base, kind: 'CREDIT_NOTE', source: 'APP' })).toBe(false);
    expect(countsAsMonthlyBilled({ ...base, kind: 'MONTHLY', source: 'APP', status: 'CANCELLED' })).toBe(false);
    expect(countsAsMonthlyBilled({ ...base, kind: 'INSTALMENT', source: 'APP' })).toBe(true);
    // an enrolment invoice (period = the school year, starting in September) never stops the September invoice
    expect(countsAsMonthlyBilled({ ...base, kind: 'ENROLMENT_FEES', source: 'APP' })).toBe(false);
  });

  it('parsing: bs-BA and plain notation, thousands separators, never floating point', () => {
    expect(parsePrice('1.234,56')).toBe(123456);
    expect(parsePrice('1234.56')).toBe(123456);
    expect(parsePrice('0,1')).toBe(10);
    expect(parsePrice('824,5')).toBe(82450);
    expect(parseQuantity(' 12 ')).toBe(12);
    expect(rowTotal({ description: 'x', unit: 'srv', quantity: '3', unitPrice: '0,10' }).total).toBe(30);
  });

  it('for 5.000 random manual invoices the recap equals quantity × unit price to the fening', () => {
    let seed = 11;
    const random = (): number => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    for (let n = 0; n < 5_000; n += 1) {
      const rows = Array.from({ length: 1 + Math.floor(random() * 5) }, () => {
        const quantity = 1 + Math.floor(random() * 999);
        const fenings = 1 + Math.floor(random() * 500_000);
        return { description: 'x', unit: 'srv' as const, quantity: String(quantity), unitPrice: `${Math.floor(fenings / 100)},${String(fenings % 100).padStart(2, '0')}`, q: quantity, f: fenings };
      });
      const r = buildManualInvoice(family(), input({ rows }));
      if (!r.ok) throw new Error(r.errors.join('; '));
      const expected = rows.reduce((a, row) => a + row.q * row.f, 0);
      const recap = invoiceRecap(r.draft.lines);
      expect([r.draft.total, recap.total, recap.salesValue]).toEqual([expected, expected, expected]);
      expect(recap.lines.every((l, i) => l.price === rows[i]?.f && l.quantity === rows[i]?.q)).toBe(true);
    }
  });
});

describe('the same service is recognised however it is typed (Director, 2026-11-22)', () => {
  it('serviceKey ignores case and spacing, like the backend', async () => {
    const { serviceKey } = await import('./manual');
    expect(serviceKey('  Ljetna   ŠKOLA 2026 — 1. sedmica ')).toBe(serviceKey('ljetna škola 2026 — 1. sedmica'));
    expect(serviceKey('Ljetna škola 2026 — 1. sedmica')).not.toBe(serviceKey('Ljetna škola 2026 — 2. sedmica'));
  });
});
