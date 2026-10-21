import { z } from 'zod';
import { call, type Result } from '@/lib/tauri/invoke';
import {
  InvoiceDetailSchema,
  InvoiceDraftSchema,
  InvoiceSummariesSchema,
  PaymentPlanSchema,
  PaymentPlansSchema,
  PaymentSchema,
} from '@/lib/validation/schemas';
import type { LegalEntityCode, SchoolYear } from '@/features/price-lists/types';
import type { PaymentPlan } from './plans';

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

/** Create or replace an IDSS payment plan (refused once an instalment is invoiced). */
export function savePaymentPlan(plan: PaymentPlan): Promise<Result<null>> {
  return call('save_payment_plan', z.null(), { plan: PaymentPlanSchema.parse(plan) });
}

export function listPaymentPlans(schoolYear: SchoolYear): Promise<Result<PaymentPlan[]>> {
  return call('list_payment_plans', PaymentPlansSchema, { schoolYear });
}
