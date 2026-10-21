import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import { amountInWords } from '@/features/billing/amount-in-words';
import { formatKM } from '@/features/billing/money';
import type { Institution } from '@/features/settings/repository';
import { formatDate } from '@/lib/format';
import { epcPayload, qrMatrix } from './payment-qr';
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
  const title = invoice.kind === 'CREDIT_NOTE' ? 'KNJIŽNO ODOBRENJE br.' : 'RAČUN br.';
  w.text(`${title} ${invoice.number}`, MARGIN, { size: 17, bold: true });
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
  if (invoice.paid > 0) {
    const open = Math.max(0, invoice.total - invoice.paid);
    w.rightText(`Uplaćeno ${formatKM(invoice.paid)} · preostalo za uplatu ${formatKM(open)}`, PAGE.width - MARGIN - 4, { size: 9 });
    w.y -= 14;
  }
  // Credit notes (imported, BR-32) are negative: "minus …" in words.
  const words = `${invoice.total < 0 ? 'minus ' : ''}${amountInWords(Math.abs(invoice.total))}`;
  for (const line of wrapText(`Slovima: ${words}`, w.regular, 8.5, CONTENT_WIDTH)) {
    w.text(line, MARGIN, { size: 8.5, color: MUTED });
    w.y -= 11;
  }
  w.y -= 14;
}

function drawPayment(w: Writer, data: InvoicePdfData): void {
  const { institution } = data;
  // Domestic payers use the slip below; IBAN/SWIFT are for payments from abroad.
  const bank = `Uplata na: ${institution.bankName} · račun ${institution.bankAccount} · IBAN ${institution.iban} · SWIFT ${institution.swift}`;
  const lines = wrapText(bank, w.regular, 8.5, CONTENT_WIDTH);
  w.ensure(lines.length * 11 + 40);
  for (const line of lines) {
    w.text(line, MARGIN, { size: 8.5 });
    w.y -= 11;
  }
  w.y -= 6;
  if (institution.invoiceNote.trim()) {
    const note = wrapText(institution.invoiceNote.trim(), w.regular, 8.5, CONTENT_WIDTH);
    w.ensure(note.length * 11 + 10);
    for (const line of note) {
      w.text(line, MARGIN, { size: 8.5 });
      w.y -= 11;
    }
    w.y -= 6;
  }
  w.ensure(30);
  w.text('Fakturisao/la:', MARGIN, { color: MUTED });
  w.text(data.operatorName, MARGIN + 90, { bold: true });
  w.y -= 14;
}

/** Payment slip area at the bottom of the last page (bottom half of A4). */
const SLIP = { bottom: MARGIN + 24, height: 290 } as const;
const SLIP_TOP = SLIP.bottom + SLIP.height;

function box(w: Writer, x: number, top: number, width: number, height: number, label: string, value: string[], bold = false): void {
  w.page.drawRectangle({ x, y: top - height, width, height, borderColor: INK, borderWidth: 0.6 });
  w.text(label, x + 4, { y: top - 9, size: 6.5, color: MUTED });
  value.forEach((line, i) => w.text(line, x + 5, { y: top - 21 - i * 11, size: bold ? 10 : 8.5, bold }));
}

/**
 * Domestic payment slip ("Nalog za uplatu / Uplatnica") pre-filled for the parent (IDSS Pravilnik čl. 3:
 * payer, child and purpose; period for instalments). The amount is what is still open on the invoice.
 * The QR uses an assumed format (EPC with BAM, DL-P008 addendum) until a bank confirms one.
 */
function drawPaymentSlip(w: Writer, data: InvoicePdfData): void {
  const { invoice } = data.detail;
  if (invoice.status === 'CANCELLED' || invoice.kind === 'CREDIT_NOTE' || invoice.total <= 0) return;
  if (w.y < SLIP_TOP + 18) w.ensure(PAGE.height);

  const cut = SLIP_TOP + 10;
  w.page.drawLine({ start: { x: MARGIN, y: cut }, end: { x: PAGE.width - MARGIN, y: cut }, thickness: 0.6, color: MUTED, dashArray: [4, 3] });
  const top = SLIP_TOP - 4;
  w.text('NALOG ZA UPLATU — UPLATNICA', MARGIN, { y: top - 8, size: 9, bold: true });
  w.rightText(`Račun ${invoice.number}`, PAGE.width - MARGIN, { y: top - 8, size: 8 });

  const gap = 10;
  const leftWidth = CONTENT_WIDTH * 0.56;
  const rightX = MARGIN + leftWidth + gap;
  const rightWidth = CONTENT_WIDTH - leftWidth - gap;
  const inner = leftWidth - 10;
  const fit = (text: string, max: number) => wrapText(text, w.regular, 8.5, inner).slice(0, max);
  const y = top - 18;

  const payer = fit([invoice.buyerName, invoice.buyerAddress].filter(Boolean).join(', '), 3);
  box(w, MARGIN, y, leftWidth, 52, 'Uplatio je (ime, adresa i telefon)', payer);
  const purpose = fit(
    `Račun ${invoice.number} · ${invoice.childName} · period ${formatDate(invoice.periodFrom)} – ${formatDate(invoice.periodTo)}`,
    3,
  );
  box(w, MARGIN, y - 60, leftWidth, 52, 'Svrha uplate', purpose);
  const payee = fit(`${data.institution.shortName}, ${data.institution.address}`, 3);
  box(w, MARGIN, y - 120, leftWidth, 52, 'Primalac / Primatelj (naziv, sjedište)', payee);

  const open = Math.max(0, invoice.total - invoice.paid);
  const rows: Array<[string, string[], boolean]> = [
    ['Mjesto i datum uplate', [], false],
    ['Račun pošiljaoca', [], false],
    ['Račun primaoca', [data.institution.bankAccount], true],
    ['Iznos KM', [open > 0 ? amountText(open) : 'plaćeno'], true],
    ['Poziv na broj', [], false],
  ];
  rows.forEach(([label, value, bold], i) => box(w, rightX, y - i * 34.4, rightWidth, 30, label, value, bold));

  const qrTop = y - 176;
  if (open > 0) drawPaymentQr(w, data, open, rightX, rightWidth, qrTop);

  w.page.drawLine({ start: { x: MARGIN, y: y - 214 }, end: { x: MARGIN + 180, y: y - 214 }, thickness: 0.5, color: INK });
  w.text('Potpis i pečat nalogodavca', MARGIN, { y: y - 224, size: 6.5, color: MUTED });
}

const QR_SIZE = 84;

function drawPaymentQr(w: Writer, data: InvoicePdfData, open: number, x: number, width: number, top: number): void {
  const { invoice } = data.detail;
  const matrix = qrMatrix(
    epcPayload({
      bic: data.institution.swift,
      payeeName: data.institution.shortName,
      iban: data.institution.iban,
      amount: open,
      remittance: `Račun ${invoice.number} ${invoice.childName}`,
    }),
  );
  const quiet = 2; // modules of white border inside the drawn square
  const module = QR_SIZE / (matrix.length + 2 * quiet);
  const left = x + width - QR_SIZE;
  matrix.forEach((row, r) =>
    row.forEach((dark, c) => {
      if (dark) {
        w.page.drawRectangle({ x: left + (c + quiet) * module, y: top - (r + quiet + 1) * module, width: module, height: module, color: rgb(0, 0, 0) });
      }
    }),
  );
  w.text('QR kod za plaćanje', x, { y: top - 12, size: 7.5, bold: true });
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
  drawPaymentSlip(w, data);
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
