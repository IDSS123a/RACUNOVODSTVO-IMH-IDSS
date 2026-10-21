import { save } from '@tauri-apps/plugin-dialog';
import { z } from 'zod';
import boldFont from '@/assets/fonts/NotoSans-Bold-Latin.ttf?inline';
import regularFont from '@/assets/fonts/NotoSans-Regular-Latin.ttf?inline';
import idssLogo from '@/assets/logos/idss.png?inline';
import imhLogo from '@/assets/logos/imh.png?inline';
import type { LegalEntityCode } from '@/features/price-lists/types';
import { getSettings, listInstitutions } from '@/features/settings/repository';
import { call, type Result } from '@/lib/tauri/invoke';
import { invoiceFileName, renderInvoicePdf, type PdfAssets } from './pdf';
import { getInvoice } from './repository';

/**
 * Application layer for invoice PDFs (DL-P007): gather the invoice, the letterhead and the operator,
 * render, and save where the operator chooses. Assets are inlined at build time (no network, no CSP change).
 */

const LOGO: Readonly<Record<LegalEntityCode, string>> = { IMH: imhLogo, IDSS: idssLogo };

function dataUrlBytes(dataUrl: string): Uint8Array {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function assetsFor(entity: LegalEntityCode): PdfAssets {
  return { regularFont: dataUrlBytes(regularFont), boldFont: dataUrlBytes(boldFont), logoPng: dataUrlBytes(LOGO[entity]) };
}

export interface InvoicePdf {
  readonly bytes: Uint8Array;
  readonly fileName: string;
  readonly number: string;
}

/** Render the PDF of an issued invoice. */
export async function buildInvoicePdf(invoiceId: string): Promise<Result<InvoicePdf>> {
  const [detail, institutions, settings] = await Promise.all([getInvoice(invoiceId), listInstitutions(), getSettings()]);
  if (!detail.success) return detail;
  if (!institutions.success) return institutions;
  if (!settings.success) return settings;
  const institution = institutions.data.find((i) => i.code === detail.data.invoice.entity);
  if (!institution) return { success: false, error: `podaci ustanove ${detail.data.invoice.entity} nisu uneseni`, code: 'NOT_FOUND' };
  if (!settings.data?.operator.fullName) return { success: false, error: 'unesite ime operatera u Postavkama (štampa se kao „Fakturisao/la“)', code: 'VALIDATION' };
  try {
    const bytes = await renderInvoicePdf(
      { detail: detail.data, institution, operatorName: settings.data.operator.fullName },
      assetsFor(detail.data.invoice.entity),
    );
    return { success: true, data: { bytes, fileName: invoiceFileName(detail.data.invoice.number), number: detail.data.invoice.number } };
  } catch (error: unknown) {
    return { success: false, error: `PDF nije napravljen: ${error instanceof Error ? error.message : String(error)}`, code: 'PDF' };
  }
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
    return { success: false, error: `dijalog za spremanje nije otvoren: ${String(error)}`, code: 'DIALOG' };
  }
  if (!path) return { success: true, data: null };
  const result = await call('save_document', z.null(), { path, bytes: Array.from(bytes), reference });
  return result.success ? { success: true, data: path } : result;
}
