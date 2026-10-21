import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import { amountInWords } from '@/features/billing/amount-in-words';
import { formatKM } from '@/features/billing/money';
import type { Institution } from '@/features/settings/repository';
import { formatDate } from '@/lib/format';
import type { InvoiceDetail } from './repository';

/**
 * Invoice PDF (DL-P007): vector A4, embedded Noto Sans, official logo and letterhead data.
 * Pure function of its inputs — the same bytes are previewed, printed, saved, mailed and zipped.
 */

export interface InvoicePdfData {
  readonly detail: Pick<InvoiceDetail, 'invoice' | 'lines'>;
  readonly institution: Institution;
  /** Printed as "Fakturisao/la" — the operator profile from Settings. */
  readonly operatorName: string;
}

export interface PdfAssets {
  readonly regularFont: Uint8Array;
  readonly boldFont: Uint8Array;
  readonly logoPng: Uint8Array;
}

const PAGE = { width: 595.28, height: 841.89 } as const;
const MARGIN = 48;
const CONTENT_WIDTH = PAGE.width - 2 * MARGIN;
const INK = rgb(0.12, 0.13, 0.15);
const MUTED = rgb(0.42, 0.44, 0.48);
const RULE = rgb(0.82, 0.83, 0.86);
const SHADE = rgb(0.95, 0.95, 0.96);
const ALERT = rgb(0.75, 0.1, 0.1);

/** Table columns: number, description, price-list amount, amount. */
const COLUMNS = { no: 28, list: 92, amount: 92 } as const;
const DESCRIPTION_WIDTH = CONTENT_WIDTH - COLUMNS.no - COLUMNS.list - COLUMNS.amount;

function amountText(fenings: number): string {
  return formatKM(fenings).replace(/\s*KM$/, '');
}

/** Split text into lines that fit the width (breaks on spaces; very long words are kept whole). */
export function wrapText(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    let line = '';
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (line && font.widthOfTextAtSize(candidate, size) > width) {
        lines.push(line);
        line = word;
      } else line = candidate;
    }
    lines.push(line);
  }
  return lines;
}

class Writer {
  page: PDFPage;
  y: number;

  private readonly doc: PDFDocument;
  readonly regular: PDFFont;
  readonly bold: PDFFont;

  constructor(doc: PDFDocument, regular: PDFFont, bold: PDFFont) {
    this.doc = doc;
    this.regular = regular;
    this.bold = bold;
    this.page = doc.addPage([PAGE.width, PAGE.height]);
    this.y = PAGE.height - MARGIN;
  }

  /** Start a new page when fewer than `height` points remain above the footer. */
  ensure(height: number, onNewPage?: () => void): void {
    if (this.y - height >= MARGIN + 40) return;
    this.page = this.doc.addPage([PAGE.width, PAGE.height]);
    this.y = PAGE.height - MARGIN;
    onNewPage?.();
  }

  text(value: string, x: number, options: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb>; y?: number } = {}): void {
    this.page.drawText(value, {
      x,
      y: options.y ?? this.y,
      size: options.size ?? 9,
      font: options.bold ? this.bold : this.regular,
      color: options.color ?? INK,
    });
  }

  rightText(value: string, right: number, options: { size?: number; bold?: boolean; y?: number; color?: ReturnType<typeof rgb> } = {}): void {
    const size = options.size ?? 9;
    const font = options.bold ? this.bold : this.regular;
    this.text(value, right - font.widthOfTextAtSize(value, size), options);
  }

  rule(y = this.y, color = RULE): void {
    this.page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE.width - MARGIN, y }, thickness: 0.6, color });
  }
}

function drawLetterhead(w: Writer, institution: Institution, logo: PDFImage): void {
  const logoHeight = 58;
  const scale = Math.min(logoHeight / logo.height, 150 / logo.width);
  const logoWidth = logo.width * scale;
  w.page.drawImage(logo, { x: MARGIN, y: w.y - logo.height * scale, width: logoWidth, height: logo.height * scale });

  const x = MARGIN + logoWidth + 18;
  const width = PAGE.width - MARGIN - x;
  let y = w.y - 9;
  for (const line of wrapText(institution.fullName, w.bold, 10, width)) {
    w.text(line, x, { y, size: 10, bold: true });
    y -= 13;
  }
  const contact = [
    institution.phone && `Tel: ${institution.phone}`,
    institution.fax && `Fax: ${institution.fax}`,
    institution.mobile && `Mob: ${institution.mobile}`,
  ].filter(Boolean);
  const details = [
    institution.address,
    contact.join(' · '),
    [institution.email, institution.website].filter(Boolean).join(' · '),
    `ID broj: ${institution.taxId} · ${institution.registrationNumber}`,
  ].filter(Boolean);
  for (const line of details) {
    for (const part of wrapText(line, w.regular, 8, width)) {
      w.text(part, x, { y, size: 8, color: MUTED });
      y -= 10.5;
    }
  }
  w.y = Math.min(y, w.y - logo.height * scale) - 12;
  w.rule();
  w.y -= 26;
}

function drawHeading(w: Writer, data: InvoicePdfData): void {
  const { invoice } = data.detail;
  w.text(`RAČUN br. ${invoice.number}`, MARGIN, { size: 17, bold: true });
  if (invoice.status === 'CANCELLED') w.rightText('STORNIRAN', PAGE.width - MARGIN, { size: 14, bold: true, color: ALERT });
  w.y -= 26;

  const top = w.y;
  w.text('KUPAC', MARGIN, { size: 7.5, bold: true, color: MUTED });
  w.y -= 13;
  w.text(invoice.buyerName, MARGIN, { size: 10.5, bold: true });
  w.y -= 13;
  for (const line of wrapText(invoice.buyerAddress || '—', w.regular, 9, CONTENT_WIDTH / 2 - 12)) {
    w.text(line, MARGIN);
    w.y -= 12;
  }
  if (invoice.childName) {
    w.text(`Dijete: ${invoice.childName}`, MARGIN);
    w.y -= 12;
  }
  const leftBottom = w.y;

  const labelX = MARGIN + CONTENT_WIDTH / 2 + 20;
  const right = PAGE.width - MARGIN;
  const facts: Array<[string, string]> = [
    ['Datum izdavanja', formatDate(invoice.issueDate)],
    ['Rok plaćanja', formatDate(invoice.dueDate)],
    ['Obračunski period', `${formatDate(invoice.periodFrom)} – ${formatDate(invoice.periodTo)}`],
  ];
  let y = top;
  for (const [label, value] of facts) {
    w.text(label, labelX, { y, color: MUTED });
    w.rightText(value, right, { y, bold: true });
    y -= 14;
  }
  w.y = Math.min(leftBottom, y) - 16;
}

function drawTableHeader(w: Writer): void {
  w.page.drawRectangle({ x: MARGIN, y: w.y - 6, width: CONTENT_WIDTH, height: 20, color: SHADE });
  const y = w.y;
  w.text('R. br.', MARGIN + 4, { y, size: 8, bold: true, color: MUTED });
  w.text('Opis', MARGIN + COLUMNS.no, { y, size: 8, bold: true, color: MUTED });
  w.rightText('Po cjenovniku', PAGE.width - MARGIN - COLUMNS.amount - 4, { y, size: 8, bold: true });
  w.rightText('Iznos (KM)', PAGE.width - MARGIN - 4, { y, size: 8, bold: true });
  w.y -= 22;
}

function drawLines(w: Writer, data: InvoicePdfData): void {
  drawTableHeader(w);
  data.detail.lines.forEach((line, index) => {
    const description = line.boardDecisionId ? `${line.description} (odluka odbora)` : line.description;
    const wrapped = wrapText(description, w.regular, 9, DESCRIPTION_WIDTH - 8);
    const height = wrapped.length * 12 + 8;
    w.ensure(height, () => drawTableHeader(w));
    w.text(`${index + 1}.`, MARGIN + 4);
    wrapped.forEach((text, i) => w.text(text, MARGIN + COLUMNS.no, { y: w.y - i * 12 }));
    w.rightText(amountText(line.listAmount), PAGE.width - MARGIN - COLUMNS.amount - 4, { size: 9 });
    w.rightText(amountText(line.amount), PAGE.width - MARGIN - 4, { size: 9 });
    w.y -= height - 4;
    w.rule(w.y + 4);
    w.y -= 8;
  });
}

function drawTotals(w: Writer, data: InvoicePdfData): void {
  const { invoice } = data.detail;
  w.ensure(90);
  w.y -= 4;
  w.text('UKUPNO ZA UPLATU', PAGE.width - MARGIN - 250, { size: 11, bold: true });
  w.rightText(formatKM(invoice.total), PAGE.width - MARGIN - 4, { size: 12, bold: true });
  w.y -= 18;
  for (const line of wrapText(`Slovima: ${amountInWords(invoice.total)}`, w.regular, 8.5, CONTENT_WIDTH)) {
    w.text(line, MARGIN, { size: 8.5, color: MUTED });
    w.y -= 11;
  }
  w.y -= 14;
}

function drawPayment(w: Writer, data: InvoicePdfData): void {
  const { institution } = data;
  const rows: Array<[string, string]> = [
    ['Primalac', institution.shortName],
    ['Banka', institution.bankName],
    ['Broj računa', institution.bankAccount],
    ['IBAN', institution.iban],
    ['SWIFT', institution.swift],
    ['Svrha uplate', `Račun ${data.detail.invoice.number}`],
  ];
  w.ensure(rows.length * 13 + 30);
  w.text('PODACI ZA UPLATU', MARGIN, { size: 7.5, bold: true, color: MUTED });
  w.y -= 14;
  for (const [label, value] of rows) {
    w.text(label, MARGIN, { color: MUTED });
    w.text(value, MARGIN + 90, { bold: label === 'Svrha uplate' });
    w.y -= 13;
  }
  w.y -= 10;
  if (institution.invoiceNote.trim()) {
    const lines = wrapText(institution.invoiceNote.trim(), w.regular, 8.5, CONTENT_WIDTH);
    w.ensure(lines.length * 11 + 10);
    for (const line of lines) {
      w.text(line, MARGIN, { size: 8.5 });
      w.y -= 11;
    }
    w.y -= 10;
  }
  w.ensure(30);
  w.text('Fakturisao/la:', MARGIN, { color: MUTED });
  w.text(data.operatorName, MARGIN + 90, { bold: true });
}

function drawFooters(doc: PDFDocument, w: Writer, data: InvoicePdfData): void {
  const pages = doc.getPages();
  pages.forEach((page, index) => {
    const label = `${data.institution.shortName} · ${data.detail.invoice.number} · strana ${index + 1}/${pages.length}`;
    page.drawLine({ start: { x: MARGIN, y: MARGIN + 14 }, end: { x: PAGE.width - MARGIN, y: MARGIN + 14 }, thickness: 0.6, color: RULE });
    page.drawText(label, { x: MARGIN, y: MARGIN, size: 7.5, font: w.regular, color: MUTED });
  });
}

/** Render one invoice as a PDF. */
export async function renderInvoicePdf(data: InvoicePdfData, assets: PdfAssets): Promise<Uint8Array> {
  if (data.detail.invoice.entity !== data.institution.code) throw new Error('institution does not match the invoice entity');
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const [regular, bold, logo] = await Promise.all([
    doc.embedFont(assets.regularFont),
    doc.embedFont(assets.boldFont),
    doc.embedPng(assets.logoPng),
  ]);
  doc.setTitle(`Račun ${data.detail.invoice.number}`);
  doc.setAuthor(data.institution.shortName);
  doc.setSubject(`${data.detail.invoice.buyerName} — ${data.detail.invoice.childName}`);
  doc.setCreator('Fakturisanje IMH & IDSS');
  doc.setProducer('Fakturisanje IMH & IDSS (pdf-lib)');
  doc.setLanguage('bs');

  const w = new Writer(doc, regular, bold);
  drawLetterhead(w, data.institution, logo);
  drawHeading(w, data);
  drawLines(w, data);
  drawTotals(w, data);
  drawPayment(w, data);
  drawFooters(doc, w, data);
  return doc.save();
}

const TRANSLITERATION: Readonly<Record<string, string>> = { č: 'c', ć: 'c', đ: 'dj', š: 's', ž: 'z', Č: 'C', Ć: 'C', Đ: 'Dj', Š: 'S', Ž: 'Z' };

/** ASCII-only text for file names (mail programs and phones mangle diacritics in attachment names). */
function asciiName(text: string): string {
  return text
    .replace(/[čćđšžČĆĐŠŽ]/g, (c) => TRANSLITERATION[c] ?? c)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * File name for an invoice PDF: number and child (Director, 2026-10-21), safe on Windows and in e-mail,
 * e.g. "IMH-001-26_Emina_Begic.pdf". The PDF itself keeps the exact spelling.
 */
export function invoiceFileName(number: string, childName: string): string {
  const child = asciiName(childName);
  return `${number.replace(/[^A-Za-z0-9-]+/g, '-')}${child ? `_${child}` : ''}.pdf`;
}
