import { describe, expect, it } from 'vitest';
import { sum } from '@/features/billing/money';
import { invoiceBalance } from '@/features/invoices/credit-notes';
import type { InvoiceSummary } from '@/features/invoices/repository';
import type { EnrolmentOverview } from './repository';
import { countedInvoices, dashboardStats } from './stats';

let n = 0;
function invoice(over: Partial<InvoiceSummary>): InvoiceSummary {
  n += 1;
  return {
    id: `i${n}`, number: `IMH-${String(n).padStart(3, '0')}/26`, entity: 'IMH', kind: 'MONTHLY', familyId: 'f', familyName: 'F', childId: 'c', childName: 'C',
    source: 'APP', buyerName: 'B', buyerAddress: '', issueDate: '2026-11-01', dueDate: '2026-11-05', periodFrom: '2026-11-01', periodTo: '2026-11-30',
    total: 71000, paid: 0, status: 'ISSUED', credited: 0, creditsInvoiceId: null, reason: '',
    ...over,
  };
}

const TODAY = '2026-11-21';

describe('dashboard figures (BR-29)', () => {
  const set: InvoiceSummary[] = [
    invoice({}), // open, overdue (due 05.11.)
    invoice({ dueDate: '2026-11-30' }), // open, not overdue
    invoice({ paid: 30000 }), // partly paid
    invoice({ paid: 71000 }), // paid
    invoice({ paid: 80000 }), // overpaid → paid, 90,00 credit
    invoice({ credited: -71000, status: 'CANCELLED' }), // fully cancelled
    invoice({ credited: -70500, paid: 0 }), // reduced to 5,00, open
    invoice({ kind: 'CREDIT_NOTE', total: -70500, number: 'IMH-KO-001/26' }), // credit-note document
    invoice({ source: 'LEGACY', kind: 'OTHER', issueDate: '2026-10-02', dueDate: '2026-10-05' }), // imported, open, overdue
    invoice({ entity: 'IDSS', total: 97000, paid: 10000 }), // IDSS partly paid
  ];
  const enrolments: EnrolmentOverview[] = [
    { familyId: 'f1', childId: 'a', program: 'PRESCHOOLERS', status: 'ACTIVE' },
    { familyId: 'f1', childId: 'b', program: 'PRIMARY_1_4', status: 'AWAITING_ENROLMENT_PAYMENT' },
    { familyId: 'f2', childId: 'c', program: 'TODDLERS', status: 'SUSPENDED' },
    { familyId: 'f3', childId: 'd', program: 'IDSS_PRESCHOOLERS', status: 'WITHDRAWN' },
    { familyId: 'f4', childId: 'e', program: 'PRIMARY_5_9', status: 'COMPLETED' },
  ];

  it('every card for both institutions', () => {
    const s = dashboardStats(set, enrolments, { entity: 'ALL', month: '2026-11', today: TODAY });
    expect(s.enrolments).toEqual({ IMH: 2, IDSS: 1, families: 2 });
    expect(s.unpaid).toEqual({ count: 4, open: 71000 + 71000 + 500 + 71000, overdueCount: 3, overdue: 71000 + 500 + 71000 });
    expect(s.partial).toEqual({ count: 2, paid: 30000 + 10000, open: 41000 + 87000 });
    expect(s.month).toEqual({
      // November: 2 open + partly paid + paid + overpaid + reduced to 5,00 + IDSS (cancelled, credit note and October excluded)
      count: 7,
      invoiced: 71000 * 5 + 500 + 97000,
      paid: 30000 + 71000 + 71000 + 10000,
      paidCount: 2,
      partialRest: 41000 + 87000,
      partialCount: 2,
      unpaid: 71000 + 71000 + 500,
      unpaidCount: 3,
    });
  });

  it('the three bar segments add up to the invoiced amount of the month, to the fening', () => {
    for (const entity of ['ALL', 'IMH', 'IDSS'] as const) {
      const m = dashboardStats(set, enrolments, { entity, month: '2026-11', today: TODAY }).month;
      expect(m.paid + m.partialRest + m.unpaid).toBe(m.invoiced);
    }
  });

  it('Σ open equals „Otvoreno“ on the register for the same filter (one balance definition, M-7)', () => {
    for (const entity of ['ALL', 'IMH', 'IDSS'] as const) {
      const rows = set.filter((i) => i.status === 'ISSUED' && i.kind !== 'CREDIT_NOTE' && (entity === 'ALL' || i.entity === entity));
      const register = sum(rows.map((i) => invoiceBalance(i).open));
      expect(dashboardStats(set, enrolments, { entity, month: '2026-11', today: TODAY }).totalOpen).toBe(register);
    }
  });

  it('IMH and IDSS are never added together unless „Sve“ is chosen (BR-1)', () => {
    const imh = dashboardStats(set, enrolments, { entity: 'IMH', month: '2026-11', today: TODAY });
    const idss = dashboardStats(set, enrolments, { entity: 'IDSS', month: '2026-11', today: TODAY });
    expect(imh.enrolments).toEqual({ IMH: 2, IDSS: 0, families: 2 });
    expect(idss.partial).toEqual({ count: 1, paid: 10000, open: 87000 });
    expect(countedInvoices(set, 'IDSS').every((i) => i.entity === 'IDSS')).toBe(true);
  });

  it('recent: newest first, at most 8, credit notes shown, cancelled invoices not', () => {
    const s = dashboardStats(set, enrolments, { entity: 'ALL', month: '2026-11', today: TODAY });
    expect(s.recent).toHaveLength(8);
    expect(s.recent.some((i) => i.kind === 'CREDIT_NOTE')).toBe(true);
    expect(s.recent.some((i) => i.status === 'CANCELLED')).toBe(false);
    const dates = s.recent.map((i) => i.issueDate);
    expect(dates).toEqual([...dates].sort().reverse());
    // 9 candidates (8 counted + the credit note): the oldest, the imported October invoice, is the one left out
    expect(s.recent.some((i) => i.issueDate === '2026-10-02')).toBe(false);
  });

  it('for 2.000 random registers the identities hold', () => {
    let seed = 3;
    const random = (): number => (seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32;
    for (let k = 0; k < 2000; k += 1) {
      const rows = Array.from({ length: 1 + Math.floor(random() * 20) }, () => {
        const total = 1 + Math.floor(random() * 200_000);
        const credited = random() < 0.2 ? -Math.floor(random() * total) : 0;
        const paid = random() < 0.3 ? 0 : Math.floor(random() * (total + 50_000));
        return invoice({ total, credited, paid, entity: random() < 0.5 ? 'IMH' : 'IDSS', issueDate: random() < 0.5 ? '2026-11-10' : '2026-10-10' });
      });
      const s = dashboardStats(rows, [], { entity: 'ALL', month: '2026-11', today: TODAY });
      expect(s.month.paid + s.month.partialRest + s.month.unpaid).toBe(s.month.invoiced);
      expect(s.unpaid.open + s.partial.open).toBe(s.totalOpen);
    }
  });
});
