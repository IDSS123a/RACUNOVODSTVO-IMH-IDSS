import { z } from 'zod';
import { call, type Result } from '@/lib/tauri/invoke';
import {
  InvoiceDetailSchema,
  InvoiceDraftSchema,
  InvoiceSummariesSchema,
  PaymentSchema,
} from '@/lib/validation/schemas';
import type { LegalEntityCode } from '@/features/price-lists/types';

/** Invoices repository — Infrastructure layer (A-3). */

export type InvoiceDraftPayload = z.infer<typeof InvoiceDraftSchema>;
export type InvoiceSummary = z.infer<typeof InvoiceSummariesSchema>[number];
export type InvoiceDetail = z.infer<typeof InvoiceDetailSchema>;
export type Payment = z.infer<typeof PaymentSchema>;

/** Issue several invoices in one transaction; returns the assigned numbers in order. */
export function issueInvoices(drafts: InvoiceDraftPayload[]): Promise<Result<string[]>> {
  return call('issue_invoices', z.array(z.string()), { drafts: z.array(InvoiceDraftSchema).parse(drafts) });
}

export function listInvoices(filter: { entity: LegalEntityCode | null; month: string | null }): Promise<Result<InvoiceSummary[]>> {
  return call('list_invoices', InvoiceSummariesSchema, { entity: filter.entity, month: filter.month });
}

export function getInvoice(invoiceId: string): Promise<Result<InvoiceDetail>> {
  return call('get_invoice', InvoiceDetailSchema, { invoiceId });
}

export function recordPayment(payment: Payment): Promise<Result<null>> {
  return call('record_payment', z.null(), { payment: PaymentSchema.parse(payment) });
}
