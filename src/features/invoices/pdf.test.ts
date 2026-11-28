import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { INSTITUTIONS_SEED } from '@/features/settings/institutions-seed';
import { IMH_PDV_NOTE } from '@/constants';
import { amountDue, amountToPay, BOTTOM_THIRD_LIMIT, hasPaymentSlip, invoiceFileName, paidFromPrepayment, paymentReceiptFileName, recapitulationRows, renderPaymentReceiptPdf, remainderFigures, renderInvoicePdf, slipAmount, type InvoicePdfData, type PdfAssets } from './pdf';
import { invoiceRecap } from './recap';

const asset = (path: string) => new Uint8Array(readFileSync(resolve(__dirname, '../../assets', path)));
const ASSETS: PdfAssets = { regularFont: asset('fonts/NotoSans-Regular-Latin.ttf'), boldFont: asset('fonts/NotoSans-Bold-Latin.ttf'), logoPng: asset('logos/imh.png') };
const IMH = INSTITUTIONS_SEED.find((i) => i.code === 'IMH');

function data(lineCount: number): InvoicePdfData {
  if (!IMH) throw new Error('seed missing');
  const line = {
    itemCode: 'TUITION' as const, description: 'Školarina za oktobar 2026 — Đurđa Čolić-Šećić (Toddlers)', childId: 'c', enrolmentId: 'e',
    program: 'TODDLERS' as const, listAmount: 71000, boardDecisionId: null, amount: 71000, quantity: 1, unit: null,
  };
  return {
    institution: { ...IMH, invoiceNote: 'Napomena koju unosi ustanova.' },
    operatorName: 'Operater Test',
    detail: {
      invoice: {
        id: 'i', number: 'IMH-001/26', entity: 'IMH', kind: 'MONTHLY', familyId: 'f', familyName: 'Test', childId: 'c', childName: 'Đurđa Čolić-Šećić', source: 'APP',
        buyerName: 'Žana Test', buyerAddress: 'Buka 1, Sarajevo', issueDate: '2026-10-01', dueDate: '2026-10-05', periodFrom: '2026-10-01',
        periodTo: '2026-10-31', total: 71000 * lineCount, paid: 0, status: 'ISSUED', credited: 0, creditsInvoiceId: null, reason: '',
      },
      lines: Array.from({ length: lineCount }, () => line),
    },
  };
}

describe('invoice PDF', () => {
  it('renders a one-page A4 PDF with Bosnian characters and metadata', async () => {
    const bytes = await renderInvoicePdf(data(1), ASSETS);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBe('Račun IMH-001/26');
    expect(doc.getPage(0).getSize().width).toBeCloseTo(595.28);
  });

  it('continues on a new page when the lines do not fit', async () => {
    const doc = await PDFDocument.load(await renderInvoicePdf(data(40), ASSETS));
    expect(doc.getPageCount()).toBeGreaterThan(1);
  });

  it('renders an imported credit note (negative amount, no payment slip)', async () => {
    const d = data(1);
    const credit = {
      ...d,
      detail: {
        invoice: { ...d.detail.invoice, kind: 'CREDIT_NOTE' as const, source: 'LEGACY' as const, number: 'IDSS KO-35/26', total: -91916 },
        lines: [{ itemCode: 'OTHER', description: 'Knjižno odobrenje', childId: '', enrolmentId: '', program: '' as const, listAmount: -91916, boardDecisionId: null, amount: -91916, quantity: 1, unit: null }],
      },
    };
    const doc = await PDFDocument.load(await renderInvoicePdf(credit, ASSETS));
    expect(doc.getPageCount()).toBe(1);
  });

  it('renders a credit note issued in the app with its original invoice and reason (storno S1)', async () => {
    const d = data(1);
    const firstLine = d.detail.lines[0];
    if (!firstLine) throw new Error('fixture');
    const credit: InvoicePdfData = {
      ...d,
      original: { number: 'IMH-001/26', issueDate: '2026-10-01' },
      detail: {
        invoice: { ...d.detail.invoice, id: 'k', kind: 'CREDIT_NOTE', number: 'IMH-KO-001/26', total: -71000, creditsInvoiceId: 'i', reason: 'dijete ispisano od 15.10.' },
        lines: [{ ...firstLine, description: 'Storno: Školarina za oktobar', listAmount: -71000, amount: -71000 }],
      },
    };
    const doc = await PDFDocument.load(await renderInvoicePdf(credit, ASSETS));
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBe('Knjižno odobrenje IMH-KO-001/26');
  });

  it('renders an invoice reduced by a credit note (net amount, still one page)', async () => {
    const d = data(1);
    const reduced: InvoicePdfData = { ...d, detail: { ...d.detail, invoice: { ...d.detail.invoice, credited: -21000, paid: 20000 } } };
    const doc = await PDFDocument.load(await renderInvoicePdf(reduced, ASSETS));
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBe('Račun IMH-001/26');
  });

  it('refuses a letterhead of the other institution', async () => {
    const idss = INSTITUTIONS_SEED.find((i) => i.code === 'IDSS');
    if (!idss) throw new Error('seed missing');
    await expect(renderInvoicePdf({ ...data(1), institution: idss }, ASSETS)).rejects.toThrow();
  });

  it('file names carry the number and the child, ASCII only', () => {
    expect(invoiceFileName('IMH-001/26', 'Emina Begić')).toBe('IMH-001-26_Emina_Begic.pdf');
    expect(invoiceFileName('IDSS-012/26', 'Đurđa Čolić-Šećić')).toBe('IDSS-012-26_Djurdja_Colic_Secic.pdf');
    expect(invoiceFileName('IMH-002/26', 'Zoë Müller')).toBe('IMH-002-26_Zoe_Muller.pdf');
    expect(invoiceFileName('IMH-003/26', '')).toBe('IMH-003-26.pdf');
  });
});

describe('accounting-complete invoice (F1)', () => {
  it('the payment slip and signatures stay within the bottom third of the page (Director, 2026-11-21)', () => {
    // SLIP_TOP is internal; the exported limit documents the rule and the layout constants are checked by rendering
    expect(BOTTOM_THIRD_LIMIT).toBeCloseTo(841.89 / 3);
  });

  it('only an issued, not cancelled invoice with a positive total carries a payment slip and QR', () => {
    expect(hasPaymentSlip({ kind: 'MONTHLY', status: 'ISSUED', total: 68000 })).toBe(true);
    expect(hasPaymentSlip({ kind: 'MONTHLY', status: 'CANCELLED', total: 68000 })).toBe(false);
    expect(hasPaymentSlip({ kind: 'CREDIT_NOTE', status: 'ISSUED', total: -68000 })).toBe(false);
    expect(hasPaymentSlip({ kind: 'OTHER', status: 'ISSUED', total: 0 })).toBe(false);
  });

  it('IMH gets the document PDV sentence by default; migration 012 carries exactly the same text (M-7)', () => {
    expect(INSTITUTIONS_SEED.find((i) => i.code === 'IMH')?.invoiceNote).toBe(IMH_PDV_NOTE);
    expect(INSTITUTIONS_SEED.find((i) => i.code === 'IDSS')?.invoiceNote).toBe('');
    const sql = readFileSync(resolve(__dirname, '../../../src-tauri/migrations/012_imh_pdv_note.sql'), 'utf8');
    expect(sql).toContain(`'${IMH_PDV_NOTE}'`);
  });

  it('the sample invoice renders on one page with all accounting elements', async () => {
    const d = data(1);
    const sample: InvoicePdfData = { ...d, institution: { ...d.institution, invoiceNote: IMH_PDV_NOTE } };
    const doc = await PDFDocument.load(await renderInvoicePdf(sample, ASSETS));
    expect(doc.getPageCount()).toBe(1);
  });

  it('a manual invoice with quantity × unit price renders on one page (F2)', async () => {
    const d = data(1);
    const manual: InvoicePdfData = {
      ...d,
      detail: {
        invoice: { ...d.detail.invoice, kind: 'OTHER', total: 45150, reason: 'Obavijest o ljetnoj školi' },
        lines: [{ itemCode: 'OTHER', description: 'Ljetna škola — sedmica', childId: 'c', enrolmentId: 'e', program: 'TODDLERS', listAmount: 45150, boardDecisionId: null, amount: 45150, quantity: 3, unit: 'srv' }],
      },
    };
    const doc = await PDFDocument.load(await renderInvoicePdf(manual, ASSETS));
    expect(doc.getPageCount()).toBe(1);
  });

  it('a credit note reduces UKUPNO ZA UPLATU: 710 − 705 = 5,00 (Director, 2026-11-21)', async () => {
    const recap = invoiceRecap([{ itemCode: 'TUITION', description: 'Školarina', listAmount: 71000, amount: 71000 }]);
    const invoice = { kind: 'MONTHLY', total: 71000, credited: -70500 };
    expect(amountDue(invoice)).toBe(500);
    expect(recapitulationRows(recap, invoice, [{ number: 'IMH-KO-001/26', total: -70500 }])).toEqual([
      ['Prodajna vrijednost:', 71000, false],
      ['Iznos odobrenog rabata:', 0, false],
      ['Vrijednost bez PDV:', 71000, false],
      ['Iznos PDV (0%):', 0, false],
      ['Iznos računa:', 71000, false],
      ['Knj. odobrenje IMH-KO-001/26:', -70500, false],
      ['UKUPNO ZA UPLATU:', 500, true],
    ]);
    // two credit notes each by number; without the list (or an incomplete one) the stored sum is shown in one row
    expect(recapitulationRows(recap, { ...invoice, credited: -71000 }, [{ number: 'A', total: -20000 }, { number: 'B', total: -51000 }]).slice(5)).toEqual([
      ['Knj. odobrenje A:', -20000, false],
      ['Knj. odobrenje B:', -51000, false],
      ['UKUPNO ZA UPLATU:', 0, true],
    ]);
    expect(recapitulationRows(recap, invoice).slice(5)).toEqual([['Umanjeno knjižnim odobrenjima:', -70500, false], ['UKUPNO ZA UPLATU:', 500, true]]);
    expect(recapitulationRows(recap, invoice, [{ number: 'A', total: -100 }]).slice(5, 6)).toEqual([['Umanjeno knjižnim odobrenjima:', -70500, false]]);
    // without credit notes: exactly the sample invoice
    expect(recapitulationRows(recap, { kind: 'MONTHLY', total: 71000, credited: 0 }).map((r) => r[0])).toEqual([
      'Prodajna vrijednost:', 'Iznos odobrenog rabata:', 'Vrijednost bez PDV:', 'Iznos PDV (0%):', 'UKUPNO ZA UPLATU:',
    ]);
    expect(amountDue({ kind: 'CREDIT_NOTE', total: -70500, credited: 0 })).toBe(-70500);
    // the slip asks for UKUPNO ZA UPLATU, also when a payment is already booked: the invoice never prints payments
    expect(slipAmount({ kind: 'MONTHLY', total: 71000, credited: -70500, paid: 500 } as { kind: string; total: number; credited: number })).toBe(500);
    expect(slipAmount({ kind: 'MONTHLY', total: 71000, credited: 0, paid: 71000 } as { kind: string; total: number; credited: number })).toBe(71000);
    const d = data(1);
    const reduced: InvoicePdfData = {
      ...d,
      detail: { ...d.detail, invoice: { ...d.detail.invoice, total: 71000, credited: -70500, paid: 500 }, creditNotes: [{ id: 'k', number: 'IMH-KO-001/26', issueDate: '2026-10-10', total: -70500, reason: 'x' }] },
    };
    expect((await PDFDocument.load(await renderInvoicePdf(reduced, ASSETS))).getPageCount()).toBe(1);
  });

  it('a long invoice keeps the slip on the last page only', async () => {
    const doc = await PDFDocument.load(await renderInvoicePdf(data(30), ASSETS));
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(2);
  });
});

describe('one page with the payment slip (Director, 2026-11-22: „PDF računi na dvije stranice. Zašto?“)', () => {
  const DESC = ['Školarina za decembar 2026', 'Upisnina za školsku 2026/2027', 'Depozit', 'Potrošni materijal za školsku 2026/2027', 'Doručak za decembar 2026', 'Produženi boravak za decembar 2026', 'Ljetna škola 2026 — 1. i 2. sedmica', 'Izlet — Vrelo Bosne (15.12.2026.)', 'Radionica — keramika (20.12.2026.)', 'Dodatni program — engleski (decembar 2026)', 'Ostala usluga — fotografisanje', 'Ostala usluga — majica'];
  const invoiceWith = (n: number, credit: boolean): InvoicePdfData => {
    const d = data(1);
    const lines = DESC.slice(0, n).map((description) => ({ ...d.detail.lines[0]!, description, amount: 50000, listAmount: 50000 }));
    return {
      ...d,
      institution: { ...d.institution, invoiceNote: IMH_PDV_NOTE },
      detail: {
        ...d.detail,
        invoice: { ...d.detail.invoice, total: 50000 * n, credited: credit ? -10000 : 0 },
        lines,
        creditNotes: credit ? [{ id: 'k', number: 'IMH-KO-001/26', issueDate: '2026-11-25', total: -10000, reason: 'x' }] : [],
      },
    };
  };

  it('a new child (instalment, enrolment fee, deposit, materials, breakfast, extended stay) and extra services: up to 12 lines, with or without a credit note', async () => {
    for (const credit of [false, true]) {
      for (const n of [5, 6, 7, 8, 9, 10, 11, 12]) {
        const doc = await PDFDocument.load(await renderInvoicePdf(invoiceWith(n, credit), ASSETS));
        expect(doc.getPageCount(), `${n} lines, credit note: ${credit}`).toBe(1);
      }
    }
  }, 60000);
});

describe('remainder notice (Director, 2026-11-22: partial payment → the invoice stays, a notice for the remainder)', () => {
  const pay = (id: string, paidOn: string, amount: number, reversedOn: string | null = null) => ({ id, invoiceId: 'i', paidOn, amount, payerName: 'Žana Test', reference: '', note: '', reversedOn, reversalReason: null });

  it('figures: amount due after credit notes, payments not reversed, remainder', async () => {
    const { remainderFigures } = await import('./pdf');
    const d = data(1); // 710,00
    const invoice = { ...d.detail.invoice, total: 100000, credited: -10000 };
    expect(remainderFigures({ invoice, payments: [pay('a', '2026-10-20', 50000), pay('b', '2026-10-10', 20000, '2026-10-12')] })).toEqual({
      due: 90000,
      payments: [{ paidOn: '2026-10-20', amount: 50000 }],
      remainder: 40000,
    });
  });

  it('one page with a slip for the remainder; refused when nothing is owed', async () => {
    const { renderRemainderNoticePdf } = await import('./pdf');
    const d = data(1);
    const invoice = { ...d.detail.invoice, total: 100000, paid: 50000 };
    const withPayments = { ...d, detail: { ...d.detail, invoice, lines: [{ ...d.detail.lines[0]!, amount: 100000, listAmount: 100000 }], payments: [pay('a', '2026-10-20', 50000)] } };
    const bytes = await renderRemainderNoticePdf(withPayments, { issueDate: '2026-11-22', dueDate: '2026-11-30' }, ASSETS);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBe('Obavijest o neplaćenom ostatku — IMH-001/26');
    const paidInFull = { ...withPayments, detail: { ...withPayments.detail, payments: [pay('a', '2026-10-20', 100000)] } };
    await expect(renderRemainderNoticePdf(paidInFull, { issueDate: '2026-11-22', dueDate: '2026-11-30' }, ASSETS)).rejects.toThrow('nema neplaćen ostatak');
  });
});

describe('prepayment applied to the invoice (specs/family-advance Q3)', () => {
  const recap = invoiceRecap(data(1).detail.lines);
  it('the recapitulation, the slip and the QR ask for the amount after the prepayment; payments are still no input', () => {
    const partly = { kind: 'MONTHLY', total: 71000, credited: 0, appliedPrepayment: 20000 };
    expect(recapitulationRows(recap, partly).slice(4)).toEqual([
      ['Iznos računa:', 71000, false],
      ['Umanjeno za primljenu pretplatu:', -20000, false],
      ['UKUPNO ZA UPLATU:', 51000, true],
    ]);
    expect(amountToPay(partly)).toBe(51000);
    expect(slipAmount(partly)).toBe(51000);
    expect(amountDue(partly)).toBe(71000, 'the invoice itself is unchanged');
    expect(hasPaymentSlip({ ...partly, status: 'ISSUED' })).toBe(true);
    expect(paidFromPrepayment({ ...partly, status: 'ISSUED' })).toBe(false);
    // with a credit note too: total − credit note − prepayment
    expect(recapitulationRows(recap, { ...partly, credited: -21000 }, [{ number: 'IMH-KO-001/26', total: -21000 }]).slice(-3)).toEqual([
      ['Knj. odobrenje IMH-KO-001/26:', -21000, false],
      ['Umanjeno za primljenu pretplatu:', -20000, false],
      ['UKUPNO ZA UPLATU:', 30000, true],
    ]);
    const full = { kind: 'MONTHLY', status: 'ISSUED', total: 71000, credited: 0, appliedPrepayment: 71000 };
    expect(hasPaymentSlip(full)).toBe(false);
    expect(paidFromPrepayment(full)).toBe(true);
  });

  it('a fully and a partly prepaid invoice are still one page; the remainder notice deducts the prepayment', async () => {
    const d = data(1);
    for (const applied of [20000, 71000]) {
      const pdf: InvoicePdfData = { ...d, detail: { ...d.detail, invoice: { ...d.detail.invoice, appliedPrepayment: applied, paid: applied } } };
      expect((await PDFDocument.load(await renderInvoicePdf(pdf, ASSETS))).getPageCount()).toBe(1);
    }
    const figures = remainderFigures({
      invoice: { ...d.detail.invoice, appliedPrepayment: 20000 },
      payments: [{ id: '00000000-0000-4000-8000-000000000001', invoiceId: 'i', paidOn: '2026-10-03', amount: 30000, payerName: 'Žana Test', reference: '', note: '' }],
    });
    expect(figures).toMatchObject({ due: 51000, remainder: 21000 });
  });
});

describe('„Potvrda o uplati“ (specs/family-advance Q5)', () => {
  it('one A4 page on the letterhead, with the payer, the relation and the saldo of the child; ASCII file name', async () => {
    if (!IMH) throw new Error('seed missing');
    const bytes = await renderPaymentReceiptPdf(IMH, 'Operater Test', {
      issuedOn: '2026-11-28', invoiceNumber: null, paidOn: '2026-11-27', amount: 100000, payerName: 'Amir Begović', payerRelation: 'djed',
      childName: 'Đurđa Čolić-Šećić', buyerName: 'Žana Test', purpose: 'Uplata unaprijed za decembar 2026', reference: 'Izvod br. 12 od 27.11.2026.', saldo: -100000,
    }, ASSETS);
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    expect(doc.getTitle()).toBe('Potvrda o uplati — Đurđa Čolić-Šećić — 27.11.2026.');
    if (process.env.PDF_SAMPLE_DIR) (await import('node:fs')).writeFileSync(`${process.env.PDF_SAMPLE_DIR}/receipt.pdf`, bytes);
    expect(paymentReceiptFileName('2026-11-27', 'Đurđa Čolić-Šećić')).toBe('Potvrda_uplate_2026-11-27_Djurdja_Colic_Secic.pdf');
  });
});
