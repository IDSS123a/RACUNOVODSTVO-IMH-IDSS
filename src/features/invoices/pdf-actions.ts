import { save } from '@tauri-apps/plugin-dialog';
import { z } from 'zod';
import boldFont from '@/assets/fonts/NotoSans-Bold-Latin.ttf?inline';
import regularFont from '@/assets/fonts/NotoSans-Regular-Latin.ttf?inline';
import idssLogo from '@/assets/logos/idss.png?inline';
import imhLogo from '@/assets/logos/imh.png?inline';
import { INVOICE_MAILBOX, MAIL_DRAFT_PDF_BYTES } from '@/constants';
import { formatKM, sum } from '@/features/billing/money';
import type { LegalEntityCode } from '@/features/price-lists/types';
import { getSettings, listInstitutions, type Institution } from '@/features/settings/repository';
import { formatDate } from '@/lib/format';
import { call, type Result } from '@/lib/tauri/invoke';
import { buildEml, chunkBySize, zipFiles } from './bundle';
import { invoiceFileName, renderInvoicePdf, type PdfAssets } from './pdf';
import { getInvoice, listInvoices, type InvoiceDetail, type InvoiceSummary } from './repository';

/**
 * Application layer for invoice PDFs (DL-P007): render one invoice, export a period as .zip (BR-31),
 * and open an Outlook draft to the invoice mailbox with every PDF and the .zip (BR-28, DL-P006).
 * Assets are inlined at build time (no network, no CSP change).
 */

const LOGO: Readonly<Record<LegalEntityCode, string>> = { IMH: imhLogo, IDSS: idssLogo };

function dataUrlBytes(dataUrl: string): Uint8Array {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function assetsFor(entity: LegalEntityCode): PdfAssets {
  return { regularFont: dataUrlBytes(regularFont), boldFont: dataUrlBytes(boldFont), logoPng: dataUrlBytes(LOGO[entity]) };
}

function fail(error: string, code = 'VALIDATION'): Result<never> {
  return { success: false, error, code };
}

/** Letterheads and the operator name, loaded once per batch. */
interface PdfContext {
  readonly institutions: ReadonlyArray<Institution>;
  readonly operatorName: string;
}

async function loadContext(): Promise<Result<PdfContext>> {
  const [institutions, settings] = await Promise.all([listInstitutions(), getSettings()]);
  if (!institutions.success) return institutions;
  if (!settings.success) return settings;
  const operatorName = settings.data?.operator.fullName;
  if (!operatorName) return fail('unesite ime operatera u Postavkama (štampa se kao „Fakturisao/la“)');
  return { success: true, data: { institutions: institutions.data, operatorName } };
}

export interface InvoicePdf {
  readonly bytes: Uint8Array;
  readonly fileName: string;
  readonly number: string;
  readonly summary: InvoiceSummary;
}

async function render(detail: InvoiceDetail, context: PdfContext): Promise<Result<InvoicePdf>> {
  const institution = context.institutions.find((i) => i.code === detail.invoice.entity);
  if (!institution) return fail(`podaci ustanove ${detail.invoice.entity} nisu uneseni`, 'NOT_FOUND');
  try {
    const bytes = await renderInvoicePdf({ detail, institution, operatorName: context.operatorName }, assetsFor(detail.invoice.entity));
    return { success: true, data: { bytes, fileName: invoiceFileName(detail.invoice.number, detail.invoice.childName), number: detail.invoice.number, summary: detail.invoice } };
  } catch (error: unknown) {
    return fail(`PDF računa ${detail.invoice.number} nije napravljen: ${error instanceof Error ? error.message : String(error)}`, 'PDF');
  }
}

/** Render the PDF of one issued invoice. */
export async function buildInvoicePdf(invoiceId: string): Promise<Result<InvoicePdf>> {
  const [detail, context] = await Promise.all([getInvoice(invoiceId), loadContext()]);
  if (!detail.success) return detail;
  if (!context.success) return context;
  return render(detail.data, context.data);
}

/** Invoices issued in a period (by issue date), optionally for one entity. */
export interface PeriodFilter {
  readonly from: string;
  readonly to: string;
  readonly entity: LegalEntityCode | null;
}

export function periodLabel(filter: PeriodFilter): string {
  return `${filter.entity ?? 'IMH i IDSS'}, ${formatDate(filter.from)} – ${formatDate(filter.to)}`;
}

/** Invoices of the period, oldest number first. */
export async function invoicesInPeriod(filter: PeriodFilter): Promise<Result<InvoiceSummary[]>> {
  if (!filter.from || !filter.to || filter.from > filter.to) return fail('odaberite ispravan period (od – do)');
  const all = await listInvoices({ entity: filter.entity, month: null });
  if (!all.success) return all;
  const rows = all.data
    .filter((i) => i.issueDate >= filter.from && i.issueDate <= filter.to)
    .sort((a, b) => a.entity.localeCompare(b.entity) || a.issueDate.localeCompare(b.issueDate) || a.number.localeCompare(b.number));
  return { success: true, data: rows };
}

/** Render every invoice of the list (one failure stops the batch — nothing is half-exported). */
async function renderAll(
  invoices: ReadonlyArray<InvoiceSummary>,
  context: PdfContext,
  onProgress?: (done: number) => void,
): Promise<Result<InvoicePdf[]>> {
  if (invoices.length === 0) return fail('u odabranom periodu nema računa');
  const pdfs: InvoicePdf[] = [];
  for (const invoice of invoices) {
    const detail = await getInvoice(invoice.id);
    if (!detail.success) return detail;
    const pdf = await render(detail.data, context);
    if (!pdf.success) return pdf;
    pdfs.push(pdf.data);
    onProgress?.(pdfs.length);
  }
  return { success: true, data: pdfs };
}

function zipName(filter: PeriodFilter, part?: { index: number; count: number }): string {
  const suffix = part && part.count > 1 ? `_dio-${part.index}-od-${part.count}` : '';
  return `Racuni_${filter.entity ?? 'IMH-IDSS'}_${filter.from}_${filter.to}${suffix}.zip`;
}

/**
 * Ask where to save, then write the document. Returns the saved path, or null when the operator cancelled.
 */
export async function saveDocument(bytes: Uint8Array, fileName: string, reference: string): Promise<Result<string | null>> {
  const extension = fileName.endsWith('.zip') ? 'zip' : 'pdf';
  let path: string | null;
  try {
    path = await save({ defaultPath: fileName, filters: [{ name: extension.toUpperCase(), extensions: [extension] }] });
  } catch (error: unknown) {
    return fail(`dijalog za spremanje nije otvoren: ${String(error)}`, 'DIALOG');
  }
  if (!path) return { success: true, data: null };
  const result = await call('save_document', z.null(), { path, bytes: Array.from(bytes), reference });
  return result.success ? { success: true, data: path } : result;
}

/** BR-31: all invoices of the period as one .zip of PDFs, saved where the operator chooses. */
export async function exportPeriodZip(filter: PeriodFilter, onProgress?: (done: number, total: number) => void): Promise<Result<string | null>> {
  const [invoices, context] = await Promise.all([invoicesInPeriod(filter), loadContext()]);
  if (!invoices.success) return invoices;
  if (!context.success) return context;
  const pdfs = await renderAll(invoices.data, context.data, (done) => onProgress?.(done, invoices.data.length));
  if (!pdfs.success) return pdfs;
  const zip = zipFiles(pdfs.data.map((p) => ({ name: p.fileName, bytes: p.bytes })));
  return saveDocument(zip, zipName(filter), `ZIP ${periodLabel(filter)} (${pdfs.data.length} računa)`);
}

function mailBody(pdfs: ReadonlyArray<InvoicePdf>, filter: PeriodFilter, zip: string, operatorName: string): string {
  const rows = pdfs.map((p) => `${p.number} | ${p.summary.childName || '—'} | ${p.summary.buyerName} | ${formatKM(p.summary.total)}`);
  return [
    'Poštovani,',
    '',
    `u prilogu su računi (${periodLabel(filter)}): ${pdfs.length} računa, ukupno ${formatKM(sum(pdfs.map((p) => p.summary.total)))}.`,
    `Svaki račun je zaseban PDF za prosljeđivanje roditelju; isti računi su i u datoteci ${zip}.`,
    '',
    'Broj računa | Dijete | Kupac | Iznos',
    ...rows,
    '',
    'Srdačan pozdrav,',
    operatorName,
  ].join('\n');
}

/**
 * BR-28 / DL-P006: open Outlook draft(s) to the invoice mailbox with every PDF and one .zip attached.
 * Large periods are split into several drafts. Returns the number of drafts opened.
 */
export async function openMailDrafts(filter: PeriodFilter, onProgress?: (done: number, total: number) => void): Promise<Result<number>> {
  const [invoices, context] = await Promise.all([invoicesInPeriod(filter), loadContext()]);
  if (!invoices.success) return invoices;
  if (!context.success) return context;
  const pdfs = await renderAll(invoices.data, context.data, (done) => onProgress?.(done, invoices.data.length));
  if (!pdfs.success) return pdfs;

  const groups = chunkBySize(pdfs.data, (p) => p.bytes.length, MAIL_DRAFT_PDF_BYTES);
  for (const [index, group] of groups.entries()) {
    const part = { index: index + 1, count: groups.length };
    const zip = zipName(filter, part);
    const subject = `Računi ${periodLabel(filter)}${groups.length > 1 ? ` (dio ${part.index}/${part.count})` : ''}`;
    const eml = buildEml(
      {
        to: INVOICE_MAILBOX,
        subject,
        body: mailBody(group, filter, zip, context.data.operatorName),
        attachments: [...group.map((p) => ({ name: p.fileName, bytes: p.bytes })), { name: zip, bytes: zipFiles(group.map((p) => ({ name: p.fileName, bytes: p.bytes }))) }],
      },
      `----=_fakturisanje_${crypto.randomUUID()}`,
    );
    const opened = await call('open_mail_draft', z.null(), {
      fileName: zip.replace(/\.zip$/, '.eml'),
      content: eml,
      reference: `${subject} (${group.length} računa)`,
    });
    if (!opened.success) return opened;
  }
  return { success: true, data: groups.length };
}
