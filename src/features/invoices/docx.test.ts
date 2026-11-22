import { unzipSync, strFromU8 } from 'fflate';
import { describe, expect, it } from 'vitest';
import { INSTITUTIONS_SEED } from '@/features/settings/institutions-seed';
import { invoiceDocumentXml, renderInvoiceDocx } from './docx';
import type { InvoicePdfData } from './pdf';

const IMH = INSTITUTIONS_SEED.find((i) => i.code === 'IMH');

function data(): InvoicePdfData {
  if (!IMH) throw new Error('seed');
  return {
    institution: IMH,
    operatorName: 'Operater Test',
    detail: {
      invoice: {
        id: 'i', number: 'IMH-012/26', entity: 'IMH', kind: 'MONTHLY', familyId: 'f', familyName: 'T', childId: 'c', childName: 'Dijete & Test', source: 'APP',
        buyerName: 'Kupac <Test>', buyerAddress: 'Buka 1, 71000 Sarajevo', issueDate: '2026-11-21', dueDate: '2026-12-05', periodFrom: '2026-12-01',
        periodTo: '2026-12-31', total: 71000, paid: 0, status: 'ISSUED', credited: -70500, creditsInvoiceId: null, reason: '',
      },
      lines: [{ itemCode: 'TUITION', description: 'Školarina za decembar 2026', childId: 'c', enrolmentId: 'e', program: 'PRESCHOOLERS', listAmount: 71000, boardDecisionId: null, amount: 71000, quantity: 1, unit: null }],
      creditNotes: [{ id: 'k', number: 'IMH-KO-001/26', issueDate: '2026-11-25', total: -70500, reason: 'x' }],
    },
  };
}

describe('invoice as DOCX (DEFINICIJA M5)', () => {
  it('is a valid Word package with the document part', () => {
    const files = unzipSync(renderInvoiceDocx(data()));
    expect(Object.keys(files).sort()).toEqual(['[Content_Types].xml', '_rels/.rels', 'word/document.xml']);
    const xml = strFromU8(files['word/document.xml'] ?? new Uint8Array());
    expect(xml.startsWith('<?xml')).toBe(true);
  });

  it('carries the same figures as the PDF: credit note row, UKUPNO ZA UPLATU and words after credit notes', () => {
    const xml = invoiceDocumentXml(data());
    expect(xml).toContain('RAČUN br. IMH-012/26');
    expect(xml).toContain('Knj. odobrenje IMH-KO-001/26:');
    expect(xml).toContain('UKUPNO ZA UPLATU:');
    expect(xml).toContain('5,00 KM');
    expect(xml).toContain('Slovima: pet i 00/100 KM');
    // special characters are escaped, the XML stays well-formed
    expect(xml).toContain('Dijete &amp; Test');
    expect(xml).toContain('Kupac &lt;Test&gt;');
    expect(xml).not.toContain('<Test>');
  });

  it('refuses the letterhead of the other institution', () => {
    const idss = INSTITUTIONS_SEED.find((i) => i.code === 'IDSS');
    if (!idss) throw new Error('seed');
    expect(() => renderInvoiceDocx({ ...data(), institution: idss })).toThrow();
  });
});
