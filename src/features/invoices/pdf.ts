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
  /** `creditNotes`: the credit notes that reduce this invoice, each printed in the recapitulation (storno). */
  readonly detail: Pick<InvoiceDetail, 'invoice' | 'lines'> & { readonly creditNotes?: InvoiceDetail['creditNotes'] };
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
  const logoHeight = 48;
  const scale = Math.min(logoHeight / logo.height, 170 / logo.width);
  const logoWidth = logo.width * scale;
  w.page.drawImage(logo, { x: MARGIN, y: w.y - logo.height * scale, width: logoWidth, height: logo.height * scale });

  const right = PAGE.width - MARGIN;
  const width = right - (MARGIN + logoWidth + 24);
  let y = w.y - 9;
  for (const line of wrapText(institution.fullName, w.bold, 10, width)) {
    w.rightText(line, right, { y, size: 10, bold: true });
    y -= 11.5;
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
    for (const part of wrapText(line, w.regular, 7.5, width)) {
      w.rightText(part, right, { y, size: 7.5, color: MUTED });
      y -= 9.5;
    }
  }
  w.y = Math.min(y, w.y - logo.height * scale) - 6;
  w.page.drawLine({ start: { x: MARGIN, y: w.y }, end: { x: right, y: w.y }, thickness: 1.6, color: DARK });
  w.y -= 24;
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
  w.y -= 14 + below;
  if (invoice.status === 'CANCELLED') {
    w.text('STORNIRAN', MARGIN, { size: 12, bold: true, color: ALERT });
    w.y -= 14;
  }
  w.y -= 4;

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
  const height = Math.max(facts.length * 12.5, buyerLines.length * 12) + 12;
  const top = w.y;
  w.page.drawRectangle({ x: MARGIN, y: top - height, width: CONTENT_WIDTH, height, color: rgb(0.97, 0.98, 0.99), borderColor: RULE, borderWidth: 0.7 });
  w.page.drawLine({ start: { x: MARGIN + half, y: top - 8 }, end: { x: MARGIN + half, y: top - height + 8 }, thickness: 0.6, color: RULE });
  facts.forEach(([label, value, bold], i) => {
    const y = top - 13 - i * 12.5;
    w.text(label, MARGIN + 10, { y, size: 9, color: MUTED });
    w.text(value, MARGIN + 108, { y, size: 9.5, bold });
  });
  buyerLines.forEach(([text, bold, size], i) => w.text(text, buyerX, { y: top - 13 - i * 12, size, bold, color: i === 0 ? MUTED : INK }));
  w.y = top - height - 10;

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
  const height = 17;
  w.page.drawRectangle({ x: MARGIN, y: w.y - height + 6, width: CONTENT_WIDTH, height, color: DARK });
  COLUMNS.forEach((column, i) => cellText(w, i, column.title, w.y - 6.5, { size: 7, bold: true, color: WHITE }));
  w.y -= height + 4;
}

/** Table rows from the recapitulation (F1 / SPEC C5); at least MIN_TABLE_ROWS rows. */
function drawLines(w: Writer, data: InvoicePdfData, recap: InvoiceRecap): void {
  drawTableHeader(w);
  const boardDecision = new Set(data.detail.lines.flatMap((l, i) => (l.boardDecisionId ? [i] : [])));
  const rows = Math.max(MIN_TABLE_ROWS, recap.lines.length);
  // more than 8 lines: denser rows and a smaller font, so the invoice still fits on one page with the slip
  const dense = recap.lines.length > 8;
  const font = dense ? 7.5 : 8.5;
  const lineGap = dense ? 8.5 : 10;
  for (let i = 0; i < rows; i += 1) {
    const line = recap.lines[i];
    const description = line ? (boardDecision.has(i) ? `${line.description} (odluka odbora)` : line.description) : '';
    const wrapped = line ? wrapText(description, w.bold, font, (COLUMNS[1]?.width ?? 150) - 8) : [''];
    // compact rows: a new child's invoice (instalment, enrolment fee, deposit, materials, breakfast, extra services)
    // stays on one page with the payment slip (Director, 2026-11-22: „PDF računi na dvije stranice. Zašto?“)
    const height = dense ? Math.max(12, wrapped.length * lineGap + 3.5) : Math.max(16, wrapped.length * lineGap + 6);
    w.ensure(height + 4, () => drawTableHeader(w));
    const top = w.y + 6;
    const mid = top - height / 2 - 3;
    cellText(w, 0, String(i + 1), mid, { size: font });
    if (line) {
      wrapped.forEach((text, k) => w.text(text, cellX(1) + 4, { y: top - (dense ? 9 : 11) - k * lineGap, size: font, bold: true }));
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
  w.y -= dense ? 6 : 10;
}

/**
 * The amount the invoice asks for: its total reduced by the credit notes that cancel it (storno S2; Director,
 * 2026-11-21: „račun 710, storniran za 705 → treba platiti 5,00“). A credit note states its own (negative) total.
 */
export function amountDue(invoice: { readonly kind: string; readonly total: number; readonly credited: number }): number {
  return invoice.kind === 'CREDIT_NOTE' ? invoice.total : invoice.total + invoice.credited;
}

/** What the documents sent to the parent ask for. */
type Payable = { readonly kind: string; readonly total: number; readonly credited: number; readonly appliedPrepayment?: number | undefined };

/**
 * UKUPNO ZA UPLATU on the invoice PDF/DOCX, its slip and QR: the amount due after credit notes, reduced by the
 * prepayment applied to the invoice (specs/family-advance Q3: „Umanjeno za primljenu pretplatu“). Ordinary payments
 * are still never an input (Director, 2026-11-21): only prepaid money the operator applied before sending.
 */
export function amountToPay(invoice: Payable): number {
  return invoice.kind === 'CREDIT_NOTE' ? invoice.total : amountDue(invoice) - (invoice.appliedPrepayment ?? 0);
}

/** Amount on the payment slip and in the QR: UKUPNO ZA UPLATU (never negative). */
export function slipAmount(invoice: Payable): number {
  return Math.max(0, amountToPay(invoice));
}

/**
 * Recapitulation rows (F1 / SPEC C7). When credit notes reduce the invoice, each one is a row
 * („Knjižno odobrenje IMH-KO-001/26“) and the dark final row UKUPNO ZA UPLATU is the amount due after them, so the
 * table, the amount in words and the payment slip all state the same figure. Without credit notes: as the sample invoice.
 */
export function recapitulationRows(
  recap: InvoiceRecap,
  invoice: Payable,
  creditNotes: ReadonlyArray<{ readonly number: string; readonly total: number }> = [],
): Array<[label: string, amount: number, isTotal: boolean]> {
  const rows: Array<[string, number, boolean]> = [
    ['Prodajna vrijednost:', recap.salesValue, false],
    ['Iznos odobrenog rabata:', recap.discount, false],
    ['Vrijednost bez PDV:', recap.netValue, false],
    ['Iznos PDV (0%):', recap.vat, false],
  ];
  if (invoice.kind === 'CREDIT_NOTE') return [...rows, ['UKUPNO ODOBRENO:', recap.total, true]];
  const applied = invoice.appliedPrepayment ?? 0;
  if (invoice.credited < 0 || applied > 0) rows.push(['Iznos računa:', recap.total, false]);
  if (invoice.credited < 0) {
    const listed = creditNotes.reduce((a, cn) => a + cn.total, 0);
    // every credit note by number; should the list be missing or incomplete, the stored sum is still shown in full
    if (creditNotes.length > 0 && listed === invoice.credited) creditNotes.forEach((cn) => rows.push([`Knj. odobrenje ${cn.number}:`, cn.total, false]));
    else rows.push(['Umanjeno knjižnim odobrenjima:', invoice.credited, false]);
  }
  if (applied > 0) rows.push(['Umanjeno za primljenu pretplatu:', -applied, false]);
  return [...rows, ['UKUPNO ZA UPLATU:', amountToPay(invoice), true]];
}

/**
 * PDV note box (F1 / SPEC C6) beside the recapitulation (C7); then payments and the amount in words (C8).
 */
function drawNoteAndRecap(w: Writer, data: InvoicePdfData, recap: InvoiceRecap): void {
  const { invoice } = data.detail;
  const { institution } = data;
  const isCreditNote = invoice.kind === 'CREDIT_NOTE';
  const noteWidth = CONTENT_WIDTH * 0.52;
  const recapX = MARGIN + noteWidth + 12;
  const recapWidth = CONTENT_WIDTH - noteWidth - 12;

  const pdvNote = institution.invoiceNote.trim();
  const squash = (text: string) => text.replace(/\s+/g, ' ').toLowerCase();
  const noteParagraphs = [
    pdvNote,
    // printed once, also when the institution's own note already contains the sentence
    squash(pdvNote).includes(squash(INVOICE_VALIDITY_NOTE)) ? '' : INVOICE_VALIDITY_NOTE,
    // nothing is paid on a credit note
    isCreditNote || paidFromPrepayment(invoice) ? '' : `Uplatu izvršiti na TRN: ${institution.bankName} -> ${institution.bankAccount.replace(/\s+/g, '')}`,
  ].filter(Boolean);
  const noteLines = noteParagraphs.flatMap((p) => wrapText(p, w.regular, 7.5, noteWidth - 16));
  const recapRows = recapitulationRows(recap, invoice, data.detail.creditNotes);
  // the sample's 19 pt rows; rows for credit notes are tighter so the slip stays on the first page
  const rowHeight = recapRows.length > 5 ? 14 : 16;
  const height = Math.max(noteLines.length * 9.5 + 24, recapRows.length * rowHeight);
  w.ensure(height + 60);
  const top = w.y + 6;

  w.page.drawRectangle({ x: MARGIN, y: top - height, width: noteWidth, height, color: rgb(0.97, 0.98, 0.99), borderColor: RULE, borderWidth: 0.7 });
  // the heading names the PDV exemption only when the institution has its PDV sentence (IDSS: open, SPEC)
  w.text(pdvNote ? 'Napomena o oslobađanju od PDV-a:' : 'Napomena:', MARGIN + 8, { y: top - 12, size: 8, bold: true });
  noteLines.forEach((line, i) => w.text(line, MARGIN + 8, { y: top - 24 - i * 9.5, size: 7.5, color: MUTED }));

  recapRows.forEach(([label, value, total], i) => {
    const y = top - i * rowHeight;
    w.page.drawRectangle({ x: recapX, y: y - rowHeight, width: recapWidth, height: rowHeight, color: total ? DARK : WHITE, borderColor: RULE, borderWidth: 0.6 });
    w.page.drawLine({ start: { x: recapX + recapWidth * 0.62, y }, end: { x: recapX + recapWidth * 0.62, y: y - rowHeight }, thickness: 0.6, color: RULE });
    const color = total ? WHITE : INK;
    w.text(label, recapX + 6, { y: y - rowHeight + 4.5, size: total ? 9 : 8.5, bold: total, color });
    w.rightText(formatKM(value), recapX + recapWidth - 6, { y: y - rowHeight + 4.5, size: total ? 9.5 : 8.5, bold: total, color });
  });
  w.y = top - height - 12;

  // Payments are never printed: the invoice is the demand the parent receives before paying, and it reads the same
  // whenever it is printed or sent (Director, 2026-11-21). Payment status lives in the register and the invoice detail.
  // The words state the final recap row: the amount due after credit notes; a credit note is negative ("minus …").
  const due = amountToPay(invoice);
  const words = `${due < 0 ? 'minus ' : ''}${amountInWords(Math.abs(due))}`;
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
 * (F1 / SPEC C9). Purpose = number, child, period (DL-P008, IDSS Pravilnik čl. 3); amount = UKUPNO ZA UPLATU, i.e.
 * the invoice after its credit notes, independent of payments (DL-P013 amendment 2, replacing DL-P008 „what is still
 * open“); place/date of payment stay blank for the parent (DL-P008). The QR uses the assumed EPC/BAM format.
 */
/** What the slip asks for when it is not the invoice itself (the remainder notice). */
interface SlipOverride {
  readonly amount: number;
  readonly purpose: string;
  readonly dueDate: string;
}

function drawPaymentSlip(w: Writer, data: InvoicePdfData, override?: SlipOverride): void {
  const { invoice } = data.detail;
  const { institution } = data;
  const open = override ? override.amount : slipAmount(invoice);
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
  fit(override?.purpose ?? `Račun ${invoice.number} · ${invoice.childName} · period ${formatDate(invoice.periodFrom)} – ${formatDate(invoice.periodTo)}`, 2).forEach((t, i) =>
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
  const amount = `= ${formatKM(open)}`;
  w.text(amount, mx + 40 - w.bold.widthOfTextAtSize(amount, 9.5) / 2, { y: my - 18, size: 9.5, bold: true });
  w.text(`do ${formatDate(override?.dueDate ?? invoice.dueDate)}`, mx + 86, { y: my - 18, size: 8.5, bold: true });
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
function drawSignatures(w: Writer, data: { readonly operatorName: string }): void {
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

/** True when the invoice carries a payment slip: an issued, not cancelled invoice with something left to pay. */
export function hasPaymentSlip(invoice: { readonly kind: string; readonly status: string; readonly total: number; readonly credited?: number; readonly appliedPrepayment?: number | undefined }): boolean {
  return invoice.kind !== 'CREDIT_NOTE' && invoice.status !== 'CANCELLED' && invoice.total > 0 && slipAmount({ ...invoice, credited: invoice.credited ?? 0 }) > 0;
}

/** Paid in full from the prepayment (Q3): no slip, and the parent is told not to pay. */
export function paidFromPrepayment(invoice: { readonly kind: string; readonly status: string; readonly total: number; readonly credited: number; readonly appliedPrepayment?: number | undefined }): boolean {
  return invoice.kind !== 'CREDIT_NOTE' && invoice.status !== 'CANCELLED' && (invoice.appliedPrepayment ?? 0) > 0 && amountToPay(invoice) <= 0;
}

/** In place of the slip: „Plaćeno iz pretplate — ne uplaćujte“. */
function drawPaidFromPrepayment(w: Writer, data: InvoicePdfData): void {
  const { invoice } = data.detail;
  const height = 70;
  const bottom = SLIP_TOP - height;
  w.page.drawRectangle({ x: MARGIN, y: bottom, width: CONTENT_WIDTH, height, borderColor: INK, borderWidth: 0.9, color: rgb(0.95, 0.98, 0.95) });
  const title = 'PLAĆENO IZ PRETPLATE — NE UPLAĆUJTE';
  w.text(title, PAGE.width / 2 - w.bold.widthOfTextAtSize(title, 13) / 2, { y: bottom + height - 26, size: 13, bold: true });
  const line = `Iznos računa ${formatKM(amountDue(invoice))} pokriven je primljenom pretplatom (${formatKM(invoice.appliedPrepayment ?? 0)}).`;
  w.text(line, PAGE.width / 2 - w.regular.widthOfTextAtSize(line, 9) / 2, { y: bottom + height - 46, size: 9, color: MUTED });
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
  const prepaid = paidFromPrepayment(data.detail.invoice);
  reserveBottom(w, withSlip || prepaid);
  if (withSlip) drawPaymentSlip(w, data);
  else if (prepaid) drawPaidFromPrepayment(w, data);
  drawSignatures(w, data);
  drawFooters(doc, w, data);
  return doc.save();
}

/**
 * „Obavijest o neplaćenom ostatku“ (Director, 2026-11-22): the issued invoice stays as it was issued (a legal document);
 * what is still owed after a partial payment goes to the parent on this separate notice, on the institution's
 * letterhead, with a payment slip for the remainder. It has no number and is not an accounting document.
 */
export interface RemainderNotice {
  /** Day the notice is made; the balance is as of this day. */
  readonly issueDate: string;
  /** Day by which the remainder is to be paid. */
  readonly dueDate: string;
}

/** The figures of the notice: amount due after credit notes, each payment that was not reversed, and what is left. */
export function remainderFigures(detail: Pick<InvoiceDetail, 'invoice' | 'payments'>): { due: number; payments: Array<{ paidOn: string; amount: number }>; remainder: number } {
  // after the prepayment applied to it (Q3): the payments listed are the parent's, the prepayment is already deducted
  const due = amountToPay(detail.invoice);
  const payments = detail.payments.filter((p) => !p.reversedOn).map((p) => ({ paidOn: p.paidOn, amount: p.amount })).sort((a, b) => a.paidOn.localeCompare(b.paidOn));
  const paid = payments.reduce((s, p) => s + p.amount, 0);
  return { due, payments, remainder: Math.max(0, due - paid) };
}

/** Render the remainder notice of an issued invoice that is not fully paid. */
export async function renderRemainderNoticePdf(data: InvoicePdfData & { readonly detail: { readonly payments: InvoiceDetail['payments'] } }, notice: RemainderNotice, assets: PdfAssets): Promise<Uint8Array> {
  const { invoice } = data.detail;
  if (invoice.entity !== data.institution.code) throw new Error('institution does not match the invoice entity');
  const figures = remainderFigures({ invoice, payments: data.detail.payments });
  if (invoice.kind === 'CREDIT_NOTE' || invoice.status === 'CANCELLED' || figures.remainder <= 0) throw new Error('račun nema neplaćen ostatak');
  const partial = figures.payments.length > 0;
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const [regular, bold, logo] = await Promise.all([doc.embedFont(assets.regularFont), doc.embedFont(assets.boldFont), doc.embedPng(assets.logoPng)]);
  const title = partial ? 'OBAVIJEST O NEPLAĆENOM OSTATKU' : 'OBAVIJEST O NEPLAĆENOM RAČUNU';
  doc.setTitle(`${partial ? 'Obavijest o neplaćenom ostatku' : 'Obavijest o neplaćenom računu'} — ${invoice.number}`);
  doc.setAuthor(data.institution.shortName);
  doc.setSubject(`${invoice.buyerName} — ${invoice.childName}`);
  doc.setCreator('Fakturisanje IMH & IDSS');
  doc.setProducer('Fakturisanje IMH & IDSS (pdf-lib)');
  doc.setLanguage('bs');

  const w = new Writer(doc, regular, bold);
  drawLetterhead(w, data.institution, logo);
  w.text(title, MARGIN, { size: 15, bold: true });
  w.rightText(`${ISSUE_PLACE}, ${formatDate(notice.issueDate)}`, PAGE.width - MARGIN, { size: 9 });
  w.y -= 16;
  w.text(`po računu br. ${invoice.number} od ${formatDate(invoice.issueDate)}`, MARGIN, { size: 10, bold: true });
  w.y -= 22;

  // buyer and invoice facts
  const facts: Array<[string, string]> = [
    ['Kupac:', invoice.buyerName],
    ['Dijete:', invoice.childName || '—'],
    ['Adresa:', invoice.buyerAddress || '—'],
    ['Obračunski period:', `${formatDate(invoice.periodFrom)} do ${formatDate(invoice.periodTo)}`],
    ['Rok plaćanja računa:', formatDate(invoice.dueDate)],
  ];
  const boxHeight = facts.length * 13 + 12;
  w.page.drawRectangle({ x: MARGIN, y: w.y - boxHeight + 6, width: CONTENT_WIDTH, height: boxHeight, color: rgb(0.97, 0.98, 0.99), borderColor: RULE, borderWidth: 0.7 });
  facts.forEach(([label, value], i) => {
    const y = w.y - 8 - i * 13;
    w.text(label, MARGIN + 10, { y, size: 9, color: MUTED });
    w.text(wrapText(value, w.bold, 9.5, CONTENT_WIDTH - 140)[0] ?? '', MARGIN + 130, { y, size: 9.5, bold: true });
  });
  w.y -= boxHeight + 12;

  // figures: amount of the invoice, each payment, the remainder
  const rows: Array<[string, number, boolean]> = [
    ['Iznos računa (za uplatu):', figures.due, false],
    ...figures.payments.map((p): [string, number, boolean] => [`Uplata od ${formatDate(p.paidOn)}:`, -p.amount, false]),
    [partial ? 'OSTATAK ZA UPLATU:' : 'ZA UPLATU:', figures.remainder, true],
  ];
  const rowHeight = 17;
  const tableX = MARGIN + CONTENT_WIDTH * 0.35;
  const tableWidth = CONTENT_WIDTH * 0.65;
  rows.forEach(([label, value, total], i) => {
    const y = w.y + 6 - i * rowHeight;
    w.page.drawRectangle({ x: tableX, y: y - rowHeight, width: tableWidth, height: rowHeight, color: total ? DARK : WHITE, borderColor: RULE, borderWidth: 0.6 });
    const color = total ? WHITE : INK;
    w.text(label, tableX + 8, { y: y - rowHeight + 5, size: total ? 9.5 : 9, bold: total, color });
    w.rightText(formatKM(value), tableX + tableWidth - 8, { y: y - rowHeight + 5, size: total ? 10 : 9, bold: total, color });
  });
  w.y -= rows.length * rowHeight + 14;
  w.text(`Slovima: ${amountInWords(figures.remainder)}`, MARGIN, { size: 9, bold: true });
  w.y -= 22;

  const text = [
    'Poštovani,',
    partial
      ? `prema našoj evidenciji na dan ${formatDate(notice.issueDate)} po računu br. ${invoice.number} uplaćeno je ${formatKM(figures.due - figures.remainder)}, a neplaćen je ostatak od ${formatKM(figures.remainder)}.`
      : `prema našoj evidenciji na dan ${formatDate(notice.issueDate)} račun br. ${invoice.number} na iznos od ${formatKM(figures.due)} nije plaćen.`,
    `Molimo Vas da iznos od ${formatKM(figures.remainder)} uplatite do ${formatDate(notice.dueDate)} na račun ${data.institution.bankAccount} (${data.institution.bankName}), uz svrhu navedenu na uplatnici ispod.`,
    'Ako ste uplatu u međuvremenu izvršili, molimo Vas da ovu obavijest smatrate bespredmetnom. Zahvaljujemo.',
  ];
  for (const paragraph of text) {
    for (const line of wrapText(paragraph, w.regular, 9, CONTENT_WIDTH)) {
      w.text(line, MARGIN, { size: 9 });
      w.y -= 12;
    }
    w.y -= 4;
  }

  reserveBottom(w, true);
  drawPaymentSlip(w, data, {
    amount: figures.remainder,
    purpose: `${partial ? 'Ostatak po računu' : 'Račun'} ${invoice.number} · ${invoice.childName}`,
    dueDate: notice.dueDate,
  });
  drawSignatures(w, data);
  drawFooters(doc, w, data);
  return doc.save();
}

/** One payment, as confirmed to the parent (specs/family-advance Q5). */
export interface PaymentReceipt {
  /** Day the receipt is made; the saldo is as of this day. */
  readonly issuedOn: string;
  /** The invoice the payment was booked on; null = a payment without an invoice (prepayment). */
  readonly invoiceNumber: string | null;
  readonly paidOn: string;
  readonly amount: number;
  readonly payerName: string;
  readonly payerRelation: string;
  readonly childName: string;
  readonly buyerName: string;
  readonly purpose: string;
  readonly reference: string;
  /** The child's saldo in the institution on `issuedOn`: positive owes, negative u pretplati. */
  readonly saldo: number;
}

/** „Potvrda o uplati“: one A4 page on the institution's letterhead, no payment slip (Q5). */
export async function renderPaymentReceiptPdf(institution: Institution, operatorName: string, receipt: PaymentReceipt, assets: PdfAssets): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const [regular, bold, logo] = await Promise.all([doc.embedFont(assets.regularFont), doc.embedFont(assets.boldFont), doc.embedPng(assets.logoPng)]);
  doc.setTitle(`Potvrda o uplati — ${receipt.childName} — ${formatDate(receipt.paidOn)}`);
  doc.setAuthor(institution.shortName);
  doc.setCreator('Fakturisanje IMH & IDSS');
  doc.setProducer('Fakturisanje IMH & IDSS (pdf-lib)');
  doc.setLanguage('bs');

  const w = new Writer(doc, regular, bold);
  drawLetterhead(w, institution, logo);
  w.text('POTVRDA O UPLATI', MARGIN, { size: 15, bold: true });
  w.rightText(`${ISSUE_PLACE}, ${formatDate(receipt.issuedOn)}`, PAGE.width - MARGIN, { size: 9 });
  w.y -= 16;
  w.text(receipt.invoiceNumber ? `po računu br. ${receipt.invoiceNumber}` : 'uplata bez računa — pretplata', MARGIN, { size: 10, bold: true });
  w.y -= 22;

  const facts: Array<[string, string]> = [
    ['Datum uplate:', formatDate(receipt.paidOn)],
    ['Iznos:', formatKM(receipt.amount)],
    ['Uplatio/la:', `${receipt.payerName}${receipt.payerRelation ? ` (${receipt.payerRelation})` : ''}`],
    ['Za dijete:', receipt.childName || '—'],
    ['Kupac na računu:', receipt.buyerName || '—'],
    ['Svrha:', receipt.purpose || '—'],
    ['Referenca:', receipt.reference || '—'],
  ];
  const boxHeight = facts.length * 15 + 12;
  w.page.drawRectangle({ x: MARGIN, y: w.y - boxHeight + 6, width: CONTENT_WIDTH, height: boxHeight, color: rgb(0.97, 0.98, 0.99), borderColor: RULE, borderWidth: 0.7 });
  facts.forEach(([label, value], i) => {
    const y = w.y - 8 - i * 15;
    w.text(label, MARGIN + 10, { y, size: 9.5, color: MUTED });
    w.text(wrapText(value, w.bold, 10, CONTENT_WIDTH - 150)[0] ?? '', MARGIN + 140, { y, size: 10, bold: true });
  });
  w.y -= boxHeight + 10;
  w.text(`Slovima: ${amountInWords(receipt.amount)}`, MARGIN, { size: 9, bold: true });
  w.y -= 26;

  // the child's saldo on the day of the receipt, with its sign (DL-P034, Q1)
  const saldoLabel = receipt.saldo > 0 ? 'duguje' : receipt.saldo < 0 ? 'u pretplati' : 'izmireno';
  const rowHeight = 20;
  w.page.drawRectangle({ x: MARGIN, y: w.y - rowHeight + 6, width: CONTENT_WIDTH, height: rowHeight, color: DARK });
  w.text(`SALDO DJETETA NA DAN ${formatDate(receipt.issuedOn)}:`, MARGIN + 8, { y: w.y - rowHeight + 12, size: 10, bold: true, color: WHITE });
  w.rightText(`${formatKM(receipt.saldo)} (${saldoLabel})`, PAGE.width - MARGIN - 8, { y: w.y - rowHeight + 12, size: 10.5, bold: true, color: WHITE });
  w.y -= rowHeight + 14;
  const explain = receipt.saldo < 0
    ? `Negativan saldo znači da je uplaćeno ${formatKM(-receipt.saldo)} više nego što je zaduženo; taj iznos se primjenjuje na sljedeće račune djeteta ili se vraća.`
    : receipt.saldo > 0
      ? `Po svim računima djeteta u ustanovi ostalo je za uplatu ${formatKM(receipt.saldo)}.`
      : 'Svi računi djeteta u ustanovi su izmireni.';
  for (const line of wrapText(explain, w.regular, 9, CONTENT_WIDTH)) {
    w.text(line, MARGIN, { size: 9, color: MUTED });
    w.y -= 12;
  }
  w.y -= 6;
  for (const line of wrapText('Potvrda je izrađena na računaru i punovažna je bez potpisa i pečata. Ne služi kao račun.', w.regular, 8.5, CONTENT_WIDTH)) {
    w.text(line, MARGIN, { size: 8.5, color: MUTED });
    w.y -= 11;
  }

  reserveBottom(w, false);
  drawSignatures(w, { operatorName });
  const pages = doc.getPages();
  pages.forEach((page, index) => {
    page.drawLine({ start: { x: MARGIN, y: MARGIN + 10 }, end: { x: PAGE.width - MARGIN, y: MARGIN + 10 }, thickness: 0.6, color: RULE });
    page.drawText(`${institution.shortName} · Potvrda o uplati · strana ${index + 1}/${pages.length}`, { x: MARGIN, y: MARGIN, size: 7, font: w.regular, color: MUTED });
  });
  return doc.save();
}

/** File name of a receipt: „Potvrda_uplate_2026-11-28_Ime_Prezime.pdf“ (ASCII). */
export function paymentReceiptFileName(paidOn: string, childName: string): string {
  const child = asciiName(childName);
  return `Potvrda_uplate_${paidOn}${child ? `_${child}` : ''}.pdf`;
}

/** File name of the remainder notice: „Obavijest_IMH-012-26_Ime_Prezime.pdf“. */
export function remainderNoticeFileName(number: string, childName: string): string {
  return `Obavijest_${invoiceFileName(number, childName)}`;
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
