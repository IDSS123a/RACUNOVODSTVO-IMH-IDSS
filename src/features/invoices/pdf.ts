import fontkit from '@pdf-lib/fontkit';
import { PDFDocument, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';
import { amountInWords } from '@/features/billing/amount-in-words';
import { formatKM } from '@/features/billing/money';
import type { Institution } from '@/features/settings/repository';
import { formatDate } from '@/lib/format';
import { INVOICE_VALIDITY_NOTE, ISSUE_PLACE, PAYMENT_METHOD } from '@/constants';
import { code39Bars } from './code39';
import { epcPayload, qrMatrix } from './payment-qr';
import { formatDiscount, invoiceRecap, type InvoiceRecap } from './recap';
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
  /** For a credit note: the invoice it cancels (storno S1/S5); null when a legacy one is not linked yet. */
  readonly original?: { readonly number: string; readonly issueDate: string } | null;
}

export interface PdfAssets {
  readonly regularFont: Uint8Array;
  readonly boldFont: Uint8Array;
  readonly logoPng: Uint8Array;
}

const PAGE = { width: 595.28, height: 841.89 } as const;
const MARGIN = 40;
const CONTENT_WIDTH = PAGE.width - 2 * MARGIN;
const INK = rgb(0.12, 0.13, 0.15);
const MUTED = rgb(0.42, 0.44, 0.48);
const RULE = rgb(0.82, 0.83, 0.86);
const DARK = rgb(0.09, 0.12, 0.2);
const WHITE = rgb(1, 1, 1);
const ALERT = rgb(0.75, 0.1, 0.1);

/**
 * Table columns as on the institutions' invoice (F1 / SPEC C5): R.br., Naziv, JM, Količina, Cijena, S rabatom,
 * Rabat %, PDV %, PDV iznos, Iznos bez PDV. Widths in points, summing to CONTENT_WIDTH.
 */
const COLUMNS: ReadonlyArray<{ readonly title: string; readonly width: number; readonly align: 'left' | 'center' | 'right' }> = [
  { title: 'R.br.', width: 26, align: 'center' },
  { title: 'Naziv usluge / artikla', width: 155, align: 'left' },
  { title: 'JM', width: 26, align: 'center' },
  { title: 'Količina', width: 38, align: 'center' },
  { title: 'Cijena', width: 52, align: 'right' },
  { title: 'S rabatom', width: 52, align: 'right' },
  { title: 'Rabat %', width: 38, align: 'right' },
  { title: 'PDV %', width: 32, align: 'right' },
  { title: 'PDV iznos', width: 40, align: 'right' },
  { title: 'Iznos bez PDV', width: 56.28, align: 'right' },
];
/** The table shows at least this many rows, as the institutions' invoice does (empty rows carry no data). */
const MIN_TABLE_ROWS = 3;

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

/** Letterhead (F1 / SPEC C1): logo of the issuing institution left; name, contacts, ID, transaction account right. */
function drawLetterhead(w: Writer, institution: Institution, logo: PDFImage): void {
  const logoHeight = 56;
  const scale = Math.min(logoHeight / logo.height, 170 / logo.width);
  const logoWidth = logo.width * scale;
  w.page.drawImage(logo, { x: MARGIN, y: w.y - logo.height * scale, width: logoWidth, height: logo.height * scale });

  const right = PAGE.width - MARGIN;
  const width = right - (MARGIN + logoWidth + 24);
  let y = w.y - 9;
  for (const line of wrapText(institution.fullName, w.bold, 10, width)) {
    w.rightText(line, right, { y, size: 10, bold: true });
    y -= 12.5;
  }
  const contact = [
    institution.phone && `Tel: ${institution.phone}`,
    institution.fax && `Fax: ${institution.fax}`,
    institution.mobile && `Mob: ${institution.mobile}`,
  ].filter(Boolean);
  const details = [
    institution.address,
    [contact.join(' · '), institution.email && `Email: ${institution.email}`].filter(Boolean).join(' · '),
    institution.website && `Web: ${institution.website}`,
    // the registration number is stored with its label as on the letterhead (e.g. "Reg. broj 65-01-0165-12")
    `ID: ${institution.taxId} · ${institution.registrationNumber}`,
    `Transakcijski račun: ${institution.bankAccount} (${institution.bankName})`,
  ].filter(Boolean) as string[];
  for (const line of details) {
    for (const part of wrapText(line, w.regular, 8, width)) {
      w.rightText(part, right, { y, size: 8, color: MUTED });
      y -= 10.5;
    }
  }
  w.y = Math.min(y, w.y - logo.height * scale) - 8;
  w.page.drawLine({ start: { x: MARGIN, y: w.y }, end: { x: right, y: w.y }, thickness: 1.6, color: DARK });
  w.y -= 30;
}

/** Narrowest module (narrow bar) in points that still scans reliably when printed (≈ 0,26 mm). */
const BARCODE_MIN_UNIT = 0.75;

/**
 * Code 39 barcode of the invoice number (F1 / SPEC C2), drawn as vector bars right-aligned at `w.y`, never
 * overlapping the title: it takes the free space right of the title, or its own row below when that is too narrow.
 * @returns the height consumed below the title row (0 when drawn beside the title)
 */
function drawBarcode(w: Writer, number: string, titleRight: number): number {
  const { bars, width } = code39Bars(number);
  const height = 30;
  const preferred = Math.min(230, width * 1.25);
  const beside = PAGE.width - MARGIN - (titleRight + 16);
  const besideFits = beside / width >= BARCODE_MIN_UNIT;
  const drawn = besideFits ? Math.min(preferred, beside) : preferred;
  const unit = drawn / width;
  const left = PAGE.width - MARGIN - width * unit;
  const baseY = besideFits ? w.y - 8 : w.y - 16 - height;
  for (const bar of bars) {
    w.page.drawRectangle({ x: left + bar.x * unit, y: baseY, width: bar.width * unit, height, color: rgb(0, 0, 0) });
  }
  return besideFits ? 0 : height + 10;
}

/** Title, barcode, facts box and buyer box (F1 / SPEC C2–C4). */
function drawHeading(w: Writer, data: InvoicePdfData): void {
  const { invoice } = data.detail;
  const isCreditNote = invoice.kind === 'CREDIT_NOTE';
  const title = `${isCreditNote ? 'KNJIŽNO ODOBRENJE br.' : 'RAČUN br.'} ${invoice.number}`;
  w.text(title, MARGIN, { size: 17, bold: true });
  const below = drawBarcode(w, invoice.number, MARGIN + w.bold.widthOfTextAtSize(title, 17));
  w.y -= 18 + below;
  if (invoice.status === 'CANCELLED') {
    w.text('STORNIRAN', MARGIN, { size: 12, bold: true, color: ALERT });
    w.y -= 14;
  }
  w.y -= 8;

  const facts: Array<[string, string, boolean]> = isCreditNote
    ? [
        ['Datum izdavanja:', formatDate(invoice.issueDate), true],
        ['Po računu br.:', data.original ? data.original.number : '—', true],
        ['Datum računa:', data.original ? formatDate(data.original.issueDate) : '—', false],
        ['Obračunski period:', `${formatDate(invoice.periodFrom)} do ${formatDate(invoice.periodTo)}`, false],
        ['Mjesto izdavanja:', ISSUE_PLACE, false],
      ]
    : [
        ['Obračunski period:', `${formatDate(invoice.periodFrom)} do ${formatDate(invoice.periodTo)}`, true],
        ['Datum izdavanja:', formatDate(invoice.issueDate), false],
        ['Rok plaćanja:', formatDate(invoice.dueDate), true],
        ['Mjesto izdavanja:', ISSUE_PLACE, false],
        ['Način plaćanja:', PAYMENT_METHOD, false],
      ];
  const half = CONTENT_WIDTH / 2;
  const buyerX = MARGIN + half + 14;
  const buyerWidth = half - 24;
  const buyerLines: Array<[string, boolean, number]> = [
    ['KUPAC / PRIMALAC USLUGE:', true, 7.5],
    ...wrapText(invoice.buyerName, w.bold, 10.5, buyerWidth).map((l): [string, boolean, number] => [l, true, 10.5]),
    ...(invoice.childName ? wrapText(`Dijete: ${invoice.childName}`, w.bold, 9.5, buyerWidth).map((l): [string, boolean, number] => [l, true, 9.5]) : []),
    ...wrapText(`Adresa: ${invoice.buyerAddress || '—'}`, w.regular, 8.5, buyerWidth).map((l): [string, boolean, number] => [l, false, 8.5]),
  ];
  const height = Math.max(facts.length * 14.5, buyerLines.length * 13) + 18;
  const top = w.y;
  w.page.drawRectangle({ x: MARGIN, y: top - height, width: CONTENT_WIDTH, height, color: rgb(0.97, 0.98, 0.99), borderColor: RULE, borderWidth: 0.7 });
  w.page.drawLine({ start: { x: MARGIN + half, y: top - 8 }, end: { x: MARGIN + half, y: top - height + 8 }, thickness: 0.6, color: RULE });
  facts.forEach(([label, value, bold], i) => {
    const y = top - 16 - i * 14.5;
    w.text(label, MARGIN + 10, { y, size: 9, color: MUTED });
    w.text(value, MARGIN + 108, { y, size: 9.5, bold });
  });
  buyerLines.forEach(([text, bold, size], i) => w.text(text, buyerX, { y: top - 16 - i * 13, size, bold, color: i === 0 ? MUTED : INK }));
  w.y = top - height - 14;

  if (isCreditNote && invoice.reason) {
    for (const line of wrapText(`Razlog: ${invoice.reason}`, w.regular, 9, CONTENT_WIDTH)) {
      w.text(line, MARGIN, { size: 9 });
      w.y -= 12;
    }
    w.y -= 6;
  }
}

function cellX(index: number): number {
  return MARGIN + COLUMNS.slice(0, index).reduce((a, c) => a + c.width, 0);
}

function cellText(w: Writer, index: number, text: string, y: number, options: { size?: number; bold?: boolean; color?: ReturnType<typeof rgb> } = {}): void {
  const column = COLUMNS[index];
  if (!column) return;
  const size = options.size ?? 8;
  const font = options.bold ? w.bold : w.regular;
  const x = cellX(index);
  const textWidth = font.widthOfTextAtSize(text, size);
  const left = column.align === 'left' ? x + 4 : column.align === 'center' ? x + (column.width - textWidth) / 2 : x + column.width - 4 - textWidth;
  w.text(text, left, { y, size, bold: options.bold, color: options.color });
}

function drawTableHeader(w: Writer): void {
  const height = 20;
  w.page.drawRectangle({ x: MARGIN, y: w.y - height + 6, width: CONTENT_WIDTH, height, color: DARK });
  COLUMNS.forEach((column, i) => cellText(w, i, column.title, w.y - 8, { size: 7, bold: true, color: WHITE }));
  w.y -= height + 4;
}

/** Table rows from the recapitulation (F1 / SPEC C5); at least MIN_TABLE_ROWS rows. */
function drawLines(w: Writer, data: InvoicePdfData, recap: InvoiceRecap): void {
  drawTableHeader(w);
  const boardDecision = new Set(data.detail.lines.flatMap((l, i) => (l.boardDecisionId ? [i] : [])));
  const rows = Math.max(MIN_TABLE_ROWS, recap.lines.length);
  for (let i = 0; i < rows; i += 1) {
    const line = recap.lines[i];
    const description = line ? (boardDecision.has(i) ? `${line.description} (odluka odbora)` : line.description) : '';
    const wrapped = line ? wrapText(description, w.bold, 8.5, (COLUMNS[1]?.width ?? 150) - 8) : [''];
    const height = Math.max(22, wrapped.length * 11 + 10);
    w.ensure(height + 4, () => drawTableHeader(w));
    const top = w.y + 6;
    const mid = top - height / 2 - 3;
    cellText(w, 0, String(i + 1), mid, { size: 8.5 });
    if (line) {
      wrapped.forEach((text, k) => w.text(text, cellX(1) + 4, { y: top - 13 - k * 11, size: 8.5, bold: true }));
      cellText(w, 2, line.unit, mid);
      cellText(w, 3, String(line.quantity), mid);
      cellText(w, 4, amountText(line.price), mid);
      cellText(w, 5, amountText(line.discounted), mid);
      cellText(w, 6, formatDiscount(line.discountBp), mid);
      cellText(w, 7, `${line.vatPercent}%`, mid);
      cellText(w, 8, amountText(line.vat), mid);
      cellText(w, 9, amountText(line.netAmount), mid, { bold: true });
    }
    // grid
    let x = MARGIN;
    for (const column of COLUMNS) {
      w.page.drawRectangle({ x, y: top - height, width: column.width, height, borderColor: RULE, borderWidth: 0.6 });
      x += column.width;
    }
    w.y -= height;
  }
  w.y -= 14;
}

/**
 * PDV note box (F1 / SPEC C6) beside the recapitulation (C7); then credit-note reduction, payments, amount in words (C8).
 */
function drawNoteAndRecap(w: Writer, data: InvoicePdfData, recap: InvoiceRecap): void {
  const { invoice } = data.detail;
  const { institution } = data;
  const isCreditNote = invoice.kind === 'CREDIT_NOTE';
  const noteWidth = CONTENT_WIDTH * 0.52;
  const recapX = MARGIN + noteWidth + 12;
  const recapWidth = CONTENT_WIDTH - noteWidth - 12;

  const pdvNote = institution.invoiceNote.trim();
  const noteParagraphs = [
    pdvNote,
    INVOICE_VALIDITY_NOTE,
    // nothing is paid on a credit note
    isCreditNote ? '' : `Uplatu izvršiti na TRN: ${institution.bankName} -> ${institution.bankAccount.replace(/\s+/g, '')}`,
  ].filter(Boolean);
  const noteLines = noteParagraphs.flatMap((p) => wrapText(p, w.regular, 8, noteWidth - 16));
  const recapRows: Array<[string, number, boolean]> = [
    ['Prodajna vrijednost:', recap.salesValue, false],
    ['Iznos odobrenog rabata:', recap.discount, false],
    ['Vrijednost bez PDV:', recap.netValue, false],
    ['Iznos PDV (0%):', recap.vat, false],
    [isCreditNote ? 'UKUPNO ODOBRENO:' : 'UKUPNO ZA UPLATU:', recap.total, true],
  ];
  const rowHeight = 19;
  const height = Math.max(noteLines.length * 10.5 + 30, recapRows.length * rowHeight);
  w.ensure(height + 60);
  const top = w.y + 6;

  w.page.drawRectangle({ x: MARGIN, y: top - height, width: noteWidth, height, color: rgb(0.97, 0.98, 0.99), borderColor: RULE, borderWidth: 0.7 });
  // the heading names the PDV exemption only when the institution has its PDV sentence (IDSS: open, SPEC)
  w.text(pdvNote ? 'Napomena o oslobađanju od PDV-a:' : 'Napomena:', MARGIN + 8, { y: top - 14, size: 8, bold: true });
  noteLines.forEach((line, i) => w.text(line, MARGIN + 8, { y: top - 28 - i * 10.5, size: 8, color: MUTED }));

  recapRows.forEach(([label, value, total], i) => {
    const y = top - i * rowHeight;
    w.page.drawRectangle({ x: recapX, y: y - rowHeight, width: recapWidth, height: rowHeight, color: total ? DARK : WHITE, borderColor: RULE, borderWidth: 0.6 });
    w.page.drawLine({ start: { x: recapX + recapWidth * 0.62, y }, end: { x: recapX + recapWidth * 0.62, y: y - rowHeight }, thickness: 0.6, color: RULE });
    const color = total ? WHITE : INK;
    w.text(label, recapX + 6, { y: y - 13, size: total ? 9 : 8.5, bold: total, color });
    w.rightText(formatKM(value), recapX + recapWidth - 6, { y: y - 13, size: total ? 9.5 : 8.5, bold: total, color });
  });
  w.y = top - height - 14;

  if (!isCreditNote && invoice.credited < 0) {
    w.rightText(
      `Umanjeno knjižnim odobrenjima ${formatKM(invoice.credited)} · za uplatu ${formatKM(invoice.total + invoice.credited)}`,
      PAGE.width - MARGIN,
      { size: 8.5, bold: true },
    );
    w.y -= 12;
  }
  if (!isCreditNote && invoice.paid > 0) {
    const open = Math.max(0, invoice.total + invoice.credited - invoice.paid);
    w.rightText(`Uplaćeno ${formatKM(invoice.paid)} · preostalo za uplatu ${formatKM(open)}`, PAGE.width - MARGIN, { size: 8.5 });
    w.y -= 12;
  }
  // Credit notes are negative: "minus …" in words.
  const words = `${invoice.total < 0 ? 'minus ' : ''}${amountInWords(Math.abs(invoice.total))}`;
  for (const line of wrapText(`Slovima: ${words}`, w.bold, 9, CONTENT_WIDTH)) {
    w.text(line, MARGIN, { size: 9, bold: true });
    w.y -= 12;
  }
}

/**
 * Bottom third of the last page (Director, 2026-11-21): the payment slip and, below it, the signature row.
 * SLIP_TOP is the highest point the slip may reach: 842 / 3 ≈ 280 pt from the bottom edge.
 */
const SIGNATURES = { bottom: MARGIN + 16, height: 40 } as const;
const SLIP = { bottom: SIGNATURES.bottom + SIGNATURES.height + 6, height: 172 } as const;
const SLIP_TOP = SLIP.bottom + SLIP.height;
export const BOTTOM_THIRD_LIMIT = PAGE.height / 3;

function label(w: Writer, text: string, x: number, y: number): void {
  w.text(text, x, { y, size: 6.5, bold: true, color: MUTED });
}

function underline(w: Writer, x: number, y: number, width: number): void {
  w.page.drawLine({ start: { x, y }, end: { x: x + width, y }, thickness: 0.5, color: MUTED });
}

/**
 * Domestic payment slip („Nalog za uplatu“), pre-filled for the parent, in the layout of the institutions' invoice
 * (F1 / SPEC C9). Purpose = number, child, period (DL-P008, IDSS Pravilnik čl. 3); amount = what is still open;
 * place/date of payment stay blank for the parent (DL-P008). The QR uses the assumed EPC/BAM format (DL-P008 addendum).
 */
function drawPaymentSlip(w: Writer, data: InvoicePdfData): void {
  const { invoice } = data.detail;
  const { institution } = data;
  const open = Math.max(0, invoice.total + invoice.credited - invoice.paid);
  const top = SLIP_TOP;
  const bottom = SLIP.bottom;
  w.page.drawRectangle({ x: MARGIN, y: bottom, width: CONTENT_WIDTH, height: SLIP.height, borderColor: INK, borderWidth: 0.9 });
  w.text('NALOG ZA UPLATU', MARGIN + 8, { y: top - 14, size: 9, bold: true });
  w.rightText('Obrazac uplatnice za fizička lica / roditelje', PAGE.width - MARGIN - 8, { y: top - 14, size: 7.5, color: MUTED });
  underline(w, MARGIN + 8, top - 19, CONTENT_WIDTH - 16);

  // left column
  const lx = MARGIN + 8;
  const lw = 228;
  const fit = (text: string, max: number, size = 8.5) => wrapText(text, w.regular, size, lw).slice(0, max);
  let y = top - 31;
  label(w, 'UPLATIO JE (IME, ADRESA I TELEFON):', lx, y);
  fit([invoice.buyerName, invoice.buyerAddress].filter(Boolean).join(', '), 2).forEach((t, i) => w.text(t, lx, { y: y - 11 - i * 10, size: 8.5 }));
  underline(w, lx, y - 25, lw);
  y -= 36;
  label(w, 'SVRHA DOZNAKE:', lx, y);
  fit(`Račun ${invoice.number} · ${invoice.childName} · period ${formatDate(invoice.periodFrom)} – ${formatDate(invoice.periodTo)}`, 2).forEach((t, i) =>
    w.text(t, lx, { y: y - 11 - i * 10, size: 8.5 }),
  );
  underline(w, lx, y - 25, lw);
  y -= 36;
  label(w, 'PRIMALAC / PRIMATELJ:', lx, y);
  w.text(wrapText(institution.shortName, w.bold, 8.5, lw)[0] ?? '', lx, { y: y - 11, size: 8.5, bold: true });
  w.text(wrapText(institution.address, w.regular, 8, lw)[0] ?? '', lx, { y: y - 21, size: 8 });
  underline(w, lx, y - 25, lw);
  y -= 38;
  label(w, 'Mjesto i datum uplate:', lx, y);
  label(w, 'Potpis nalogodavca:', lx + 128, y);
  underline(w, lx, y - 16, 112);
  underline(w, lx + 128, y - 16, lw - 128);

  // middle column
  const mx = lx + lw + 14;
  const mw = 156;
  let my = top - 31;
  label(w, 'RAČUN PRIMAOCA / PRIMATELJA:', mx, my);
  const digits = institution.bankAccount.replace(/\D/g, '');
  const cell = Math.min(9.6, mw / Math.max(16, digits.length));
  [...digits].forEach((digit, i) => {
    w.page.drawRectangle({ x: mx + i * cell, y: my - 20, width: cell, height: 13, borderColor: INK, borderWidth: 0.6 });
    w.text(digit, mx + i * cell + cell / 2 - w.bold.widthOfTextAtSize(digit, 8.5) / 2, { y: my - 17, size: 8.5, bold: true });
  });
  my -= 32;
  label(w, 'IZNOS (KM):', mx, my);
  label(w, 'ROK UPLATE:', mx + 86, my);
  w.page.drawRectangle({ x: mx, y: my - 24, width: 80, height: 18, borderColor: INK, borderWidth: 0.9 });
  const amount = open > 0 ? `= ${formatKM(open)}` : 'plaćeno';
  w.text(amount, mx + 40 - w.bold.widthOfTextAtSize(amount, 9.5) / 2, { y: my - 18, size: 9.5, bold: true });
  w.text(`do ${formatDate(invoice.dueDate)}`, mx + 86, { y: my - 18, size: 8.5, bold: true });
  my -= 34;
  w.page.drawRectangle({ x: mx, y: my - 39, width: mw, height: 41, borderColor: MUTED, borderWidth: 0.5, borderDashArray: [2, 2] });
  w.text('Podaci za uplatu:', mx + 4, { y: my - 8, size: 6.5, bold: true, color: MUTED });
  w.text(wrapText(institution.bankName, w.regular, 7.5, mw - 8)[0] ?? '', mx + 4, { y: my - 18, size: 7.5 });
  w.text(`IBAN: ${institution.iban}`, mx + 4, { y: my - 27, size: 7.5, bold: true });
  w.text(`SWIFT: ${institution.swift}`, mx + 4, { y: my - 36, size: 7.5, bold: true });
  my -= 46;
  w.page.drawRectangle({ x: mx, y: my - 22, width: 52, height: 22, borderColor: MUTED, borderWidth: 0.5 });
  w.text('Pečat banke', mx + 6, { y: my - 14, size: 6.5, color: MUTED });
  label(w, 'Potpis ovlaštenog lica:', mx + 58, my - 10);
  underline(w, mx + 58, my - 20, mw - 58);

  // right column: QR (only while something is still open)
  const rx = mx + mw + 10;
  const rw = PAGE.width - MARGIN - 8 - rx;
  w.page.drawRectangle({ x: rx, y: bottom + 10, width: rw, height: SLIP.height - 40, borderColor: RULE, borderWidth: 0.7 });
  if (open > 0) drawPaymentQr(w, data, open, rx, rw, top - 32);
}

/** QR in the assumed EPC/BAM format (DL-P008 addendum); label „QR kod za plaćanje“ (Director, 21.10). */
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
  const size = Math.min(width - 12, 92);
  const quiet = 2;
  const module = size / (matrix.length + 2 * quiet);
  const left = x + (width - size) / 2;
  w.text('QR kod za plaćanje', x + width / 2 - w.bold.widthOfTextAtSize('QR kod za plaćanje', 7) / 2, { y: top - 8, size: 7, bold: true });
  const qrTop = top - 14;
  matrix.forEach((row, r) =>
    row.forEach((dark, c) => {
      if (dark) {
        w.page.drawRectangle({ x: left + (c + quiet) * module, y: qrTop - (r + quiet + 1) * module, width: module, height: module, color: rgb(0, 0, 0) });
      }
    }),
  );
}

/** Signature row (F1 / SPEC C10): Fakturisao/la, M.P., Ovlašteno lice, Komitent. */
function drawSignatures(w: Writer, data: InvoicePdfData): void {
  const y = SIGNATURES.bottom + SIGNATURES.height - 8;
  const columns: Array<[string, string]> = [
    ['Fakturisao / la:', data.operatorName],
    ['', 'M.P.'],
    ['Ovlašteno lice:', ''],
    ['Komitent:', ''],
  ];
  const width = CONTENT_WIDTH / columns.length;
  columns.forEach(([title, value], i) => {
    const center = MARGIN + width * i + width / 2;
    if (title) w.text(title, center - w.regular.widthOfTextAtSize(title, 8) / 2, { y, size: 8, color: MUTED });
    if (value) w.text(value, center - w.bold.widthOfTextAtSize(value, 9) / 2, { y: y - 13, size: 9, bold: true });
    if (title) w.page.drawLine({ start: { x: center - width / 2 + 10, y: y - 26 }, end: { x: center + width / 2 - 10, y: y - 26 }, thickness: 0.5, color: MUTED, dashArray: [1, 2] });
  });
}

/** Reserve the bottom third on the last page: start a new page if the body reached it. */
function reserveBottom(w: Writer, withSlip: boolean): void {
  // only what this document prints there: slip + signatures, or (credit note, cancelled) the signatures alone
  const top = withSlip ? SLIP_TOP : SIGNATURES.bottom + SIGNATURES.height;
  if (w.y < top + 10) w.ensure(PAGE.height);
}

function drawFooters(doc: PDFDocument, w: Writer, data: InvoicePdfData): void {
  const pages = doc.getPages();
  pages.forEach((page, index) => {
    const text = `${data.institution.shortName} · ${data.detail.invoice.number} · strana ${index + 1}/${pages.length}`;
    page.drawLine({ start: { x: MARGIN, y: MARGIN + 10 }, end: { x: PAGE.width - MARGIN, y: MARGIN + 10 }, thickness: 0.6, color: RULE });
    page.drawText(text, { x: MARGIN, y: MARGIN, size: 7, font: w.regular, color: MUTED });
  });
}

/** True when the invoice carries a payment slip: an issued, not cancelled invoice with a positive total. */
export function hasPaymentSlip(invoice: { readonly kind: string; readonly status: string; readonly total: number }): boolean {
  return invoice.kind !== 'CREDIT_NOTE' && invoice.status !== 'CANCELLED' && invoice.total > 0;
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
  doc.setTitle(`${data.detail.invoice.kind === 'CREDIT_NOTE' ? 'Knjižno odobrenje' : 'Račun'} ${data.detail.invoice.number}`);
  doc.setAuthor(data.institution.shortName);
  doc.setSubject(`${data.detail.invoice.buyerName} — ${data.detail.invoice.childName}`);
  doc.setCreator('Fakturisanje IMH & IDSS');
  doc.setProducer('Fakturisanje IMH & IDSS (pdf-lib)');
  doc.setLanguage('bs');

  const recap = invoiceRecap(data.detail.lines);
  const w = new Writer(doc, regular, bold);
  drawLetterhead(w, data.institution, logo);
  drawHeading(w, data);
  drawLines(w, data, recap);
  drawNoteAndRecap(w, data, recap);
  const withSlip = hasPaymentSlip(data.detail.invoice);
  reserveBottom(w, withSlip);
  if (withSlip) drawPaymentSlip(w, data);
  drawSignatures(w, data);
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
