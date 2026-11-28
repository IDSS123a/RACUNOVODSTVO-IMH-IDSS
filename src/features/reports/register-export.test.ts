import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import type { InvoiceSummary } from '@/features/invoices/repository';
import { buildRegisterCsv, buildRegisterDocx, buildRegisterXlsx, byMonth, openByFamily, registerRows, REGISTER_HEADER, totals } from './register-export';

let n = 0;
function invoice(over: Partial<InvoiceSummary>): InvoiceSummary {
  n += 1;
  return {
    id: `i${n}`, number: `IMH-${String(n).padStart(3, '0')}/26`, entity: 'IMH', kind: 'MONTHLY', familyId: 'f1', familyName: 'Begić', childId: 'c', childName: 'Ana Begić',
    source: 'APP', buyerName: 'Amra Begić', buyerAddress: '', issueDate: '2026-11-01', dueDate: '2026-11-05', periodFrom: '2026-11-01', periodTo: '2026-11-30',
    total: 100000, paid: 0, status: 'ISSUED', credited: 0, creditsInvoiceId: null, reason: '',
    ...over,
  };
}

const set = [
  invoice({ paid: 50000 }), // 1.000 KM, 500 paid → 500 open (Director's example)
  invoice({ paid: 100000, familyId: 'f2', familyName: 'Hodžić' }),
  invoice({ periodFrom: '2026-12-01', issueDate: '2026-11-25', dueDate: '2026-12-05' }),
  invoice({ kind: 'CREDIT_NOTE', total: -20000, number: 'IMH-KO-001/26' }),
  invoice({ status: 'CANCELLED', credited: -100000 }),
];

describe('reporting exports (DEFINICIJA M7)', () => {
  it('totals on the register definition: partial payment, credit-note documents and cancelled invoices excluded', () => {
    expect(totals(set, '2026-11-21')).toEqual({ count: 3, invoiced: 300000, paid: 150000, open: 150000, overdue: 50000 });
    expect(byMonth(set, '2026-11-21').map((m) => [m.month, m.count, m.open])).toEqual([['2026-11', 2, 50000], ['2026-12', 1, 100000]]);
    expect(openByFamily(set)).toEqual([{ family: 'Begić', buyer: 'Amra Begić', count: 2, open: 150000 }]);
  });

  it('one register row per invoice, in KM, with status and source', () => {
    const rows = registerRows(set);
    expect(rows).toHaveLength(5);
    expect(rows[0]?.length).toBe(REGISTER_HEADER.length);
    const first = rows.find((r) => r[0] === 'IMH-001/26');
    expect(first?.slice(10, 17)).toEqual([1000, 0, 1000, 500, 500, 'Djelimično plaćen', 'Aplikacija']);
  });

  it('XLSX has four sheets; CSV keeps Bosnian letters and decimal commas and neutralises formulas', () => {
    const files = unzipSync(buildRegisterXlsx(set, { title: 'IMH', createdOn: '2026-11-21' }));
    const workbook = strFromU8(files['xl/workbook.xml'] ?? new Uint8Array());
    for (const sheet of ['Sažetak', 'Fakture', 'Po mjesecima', 'Otvoreno po porodicama']) expect(workbook).toContain(sheet);
    const bytes = buildRegisterCsv([...set, invoice({ childName: '=HYPERLINK("x")' })]);
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // UTF-8 BOM
    const csv = strFromU8(bytes);
    expect(csv).toContain('"Ana Begić"');
    expect(csv).toContain(';1000,00;');
    expect(csv).toContain(`"'=HYPERLINK(""x"")"`);
  });

  it('DOCX report is on the institution letterhead (official document, Director 2026-11-21)', () => {
    const letterhead = new Uint8Array(readFileSync(resolve(__dirname, '../../assets/letterheads/imh.dotx')));
    const files = unzipSync(buildRegisterDocx(set, { title: 'IMH', createdOn: '2026-11-21' }, letterhead));
    const xml = strFromU8(files['word/document.xml'] ?? new Uint8Array());
    expect(xml).toContain('Izvještaj o fakturisanju i naplati');
    expect(xml).toContain('Sarajevo, 21.11.2026. godine');
    expect(xml).toContain('Begić');
    // the letterhead's header (logo) and footer (institution data) stay referenced
    expect(xml).toContain('<w:headerReference');
    expect(xml).toContain('<w:footerReference');
    expect(strFromU8(files['word/footer1.xml'] ?? new Uint8Array())).toContain('International Montessori House');
  });
});

describe('list „Pretplate“ (specs/family-advance, for the accountant K1)', () => {
  it('only children in prepayment or with prepaid money; the total is the sum of the negative saldos', async () => {
    const { prepaymentRows, prepaidTotal } = await import('./register-export');
    const card = (childName: string, saldo: number, prepaid: number) => ({
      entity: 'IMH' as const, childId: childName, familyId: 'f', familyName: 'Begović', childName,
      charged: 71000, received: 71000 - saldo, transferredIn: 0, transferredOut: 0, refunded: 0, prepaid, saldo,
    });
    const rows = prepaymentRows([card('Amir', -100000, 100000), card('Lejla', 0, 0), card('Emir', 20000, 0)]);
    expect(rows).toEqual([['IMH', 'Begović', 'Amir', 710, 1710, 0, 0, 1000, -1000]]);
    expect(prepaidTotal([card('Amir', -100000, 100000), card('Emir', 20000, 0)])).toBe(-100000);
  });
});
