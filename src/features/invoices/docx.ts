import { documentXml, para, table, wordPackage } from '@/lib/export/docx';
import { onLetterhead } from '@/lib/export/letterhead';
import { amountInWords } from '@/features/billing/amount-in-words';
import { formatKM } from '@/features/billing/money';
import { INVOICE_VALIDITY_NOTE, ISSUE_PLACE, PAYMENT_METHOD } from '@/constants';
import { formatDate } from '@/lib/format';
import { amountToPay, recapitulationRows, type InvoicePdfData } from './pdf';
import { formatDiscount, invoiceRecap } from './recap';

/**
 * The invoice as a Word document (.docx; DEFINICIJA-APLIKACIJE M5). Same content and the same figures as the PDF
 * (one recapitulation, `recapitulationRows` / `amountToPay`, M-7). A .docx is a zip of WordprocessingML; it is written
 * here with fflate, already a dependency (no new library, M-12). On the institution's letterhead (Director,
 * 2026-11-21) the logo is in its header and the institution data in its footer; the payment slip stays in the PDF.
 */

const amount = (fenings: number): string => formatKM(fenings).replace(' KM', '');

/** The body parts of one invoice; without a letterhead the institution data opens the document. */
export function invoiceParts(data: InvoicePdfData, onTemplate: boolean): string[] {
  const { invoice } = data.detail;
  const { institution } = data;
  const isCreditNote = invoice.kind === 'CREDIT_NOTE';
  const recap = invoiceRecap(data.detail.lines);
  const due = amountToPay(invoice);
  const parts: string[] = [];

  if (!onTemplate) {
    parts.push(para(institution.fullName, { bold: true, size: 12 }));
    parts.push(para(institution.address, { size: 9 }));
    parts.push(para([institution.phone && `Tel: ${institution.phone}`, institution.email && `Email: ${institution.email}`, institution.website].filter(Boolean).join(' · '), { size: 9 }));
    parts.push(para(`ID: ${institution.taxId} · ${institution.registrationNumber}`, { size: 9 }));
    parts.push(para(`Transakcijski račun: ${institution.bankAccount} (${institution.bankName}) · IBAN ${institution.iban} · SWIFT ${institution.swift}`, { size: 9 }));
    parts.push(para(''));
  }
  parts.push(para(`${isCreditNote ? 'KNJIŽNO ODOBRENJE br.' : 'RAČUN br.'} ${invoice.number}`, { bold: true, size: 16 }));
  if (isCreditNote && data.original) parts.push(para(`Za račun ${data.original.number} od ${formatDate(data.original.issueDate)} · razlog: ${invoice.reason}`, { size: 10 }));
  parts.push(
    table(
      [2600, 2900, 2600, 2900],
      [
        ['Obračunski period', `${formatDate(invoice.periodFrom)} do ${formatDate(invoice.periodTo)}`, 'Kupac', invoice.buyerName],
        ['Datum izdavanja', formatDate(invoice.issueDate), 'Dijete', invoice.childName || '—'],
        ['Rok plaćanja', formatDate(invoice.dueDate), 'Adresa', invoice.buyerAddress || '—'],
        ['Mjesto izdavanja', ISSUE_PLACE, 'Način plaćanja', PAYMENT_METHOD],
      ],
    ),
  );
  parts.push(para(''));
  parts.push(
    table(
      [600, 4000, 700, 900, 1300, 1300, 900, 1300],
      [
        ['R.br.', 'Naziv usluge / artikla', 'JM', 'Količina', 'Cijena', 'S rabatom', 'Rabat %', 'Iznos bez PDV'],
        ...recap.lines.map((l) => [String(l.position), l.description, l.unit, String(l.quantity), amount(l.price), amount(l.discounted), formatDiscount(l.discountBp), amount(l.netAmount)]),
      ],
      { header: true, right: [3, 4, 5, 6, 7] },
    ),
  );
  parts.push(para(''));
  const rows = recapitulationRows(recap, invoice, data.detail.creditNotes);
  parts.push(table([7000, 4000], rows.map(([label, value]) => [label, formatKM(value)]), { right: [1] }));
  parts.push(para(`Slovima: ${due < 0 ? 'minus ' : ''}${amountInWords(Math.abs(due))}`, { bold: true, size: 10 }));
  parts.push(para(''));
  if (institution.invoiceNote.trim()) parts.push(para(institution.invoiceNote.trim(), { size: 9 }));
  parts.push(para(INVOICE_VALIDITY_NOTE, { size: 9 }));
  if (!isCreditNote && due > 0) parts.push(para(`Uplatu izvršiti na TRN: ${institution.bankName} → ${institution.bankAccount}, svrha: račun ${invoice.number}`, { size: 9 }));
  parts.push(para(''));
  parts.push(para(`Fakturisao/la: ${data.operatorName}                    M.P.                    Ovlašteno lice: ________________`, { size: 9 }));

  return parts;
}

/** The WordprocessingML document of one invoice without a letterhead. Exported for tests. */
export function invoiceDocumentXml(data: InvoicePdfData): string {
  return documentXml(invoiceParts(data, false));
}

/** A complete .docx file of one invoice — on the institution's letterhead when it is given. */
export function renderInvoiceDocx(data: InvoicePdfData, letterhead?: Uint8Array): Uint8Array {
  if (data.detail.invoice.entity !== data.institution.code) throw new Error('institution does not match the invoice entity');
  return letterhead ? onLetterhead(letterhead, invoiceParts(data, true)) : wordPackage(invoiceDocumentXml(data));
}
