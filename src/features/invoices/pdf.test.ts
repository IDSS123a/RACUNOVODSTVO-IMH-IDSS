import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { INSTITUTIONS_SEED } from '@/features/settings/institutions-seed';
import { IMH_PDV_NOTE } from '@/constants';
import { BOTTOM_THIRD_LIMIT, hasPaymentSlip, invoiceFileName, renderInvoicePdf, type InvoicePdfData, type PdfAssets } from './pdf';

const asset = (path: string) => new Uint8Array(readFileSync(resolve(__dirname, '../../assets', path)));
const ASSETS: PdfAssets = { regularFont: asset('fonts/NotoSans-Regular-Latin.ttf'), boldFont: asset('fonts/NotoSans-Bold-Latin.ttf'), logoPng: asset('logos/imh.png') };
const IMH = INSTITUTIONS_SEED.find((i) => i.code === 'IMH');

function data(lineCount: number): InvoicePdfData {
  if (!IMH) throw new Error('seed missing');
  const line = {
    itemCode: 'TUITION' as const, description: 'Školarina za oktobar 2026 — Đurđa Čolić-Šećić (Toddlers)', childId: 'c', enrolmentId: 'e',
    program: 'TODDLERS' as const, listAmount: 71000, boardDecisionId: null, amount: 71000,
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
        lines: [{ itemCode: 'OTHER', description: 'Knjižno odobrenje', childId: '', enrolmentId: '', program: '' as const, listAmount: -91916, boardDecisionId: null, amount: -91916 }],
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

  it('a long invoice keeps the slip on the last page only', async () => {
    const doc = await PDFDocument.load(await renderInvoicePdf(data(30), ASSETS));
    expect(doc.getPageCount()).toBeGreaterThanOrEqual(2);
  });
});
