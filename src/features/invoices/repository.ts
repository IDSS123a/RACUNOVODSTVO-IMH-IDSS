import { z } from 'zod';
import { call, type Result } from '@/lib/tauri/invoke';
import {
  InvoiceDetailSchema,
  InvoiceDraftSchema,
  InvoiceSummariesSchema,
  PaymentPlanSchema,
  PaymentPlansSchema,
  PaymentSchema,
  CreditMoveSchema,
  CreditNoteDraftSchema,
  FamilyCreditSchema,
  IssuedCreditNoteSchema,
  PaymentReversalSchema,
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

export const BilledOneTimeSchema = z.object({
  /** Null for an imported invoice of the old workbook (no enrolment). */
  enrolmentId: z.string().nullable(),
  childId: z.string(),
  entity: z.enum(['IMH', 'IDSS']),
  itemCode: z.string(),
  invoiceNumber: z.string(),
  issueDate: z.string(),
});
export type BilledOneTime = z.infer<typeof BilledOneTimeSchema>;

/** Enrolment fee, materials and deposit already on issued invoices of a school year (one invoice per child). */
export function listBilledOneTime(schoolYear: SchoolYear): Promise<Result<BilledOneTime[]>> {
  return call('list_billed_one_time', z.array(BilledOneTimeSchema), { schoolYear });
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

// ---------- Storno, credit notes, payment correction (specs/storno-credit-notes) ----------

export type CreditNoteDraftPayload = z.infer<typeof CreditNoteDraftSchema>;
export type IssuedCreditNote = z.infer<typeof IssuedCreditNoteSchema>;
export type FamilyCredit = z.infer<typeof FamilyCreditSchema>[number];

/** Issue a credit note (S1, S2); the backend numbers it and cancels the invoice when its net reaches 0. */
export function issueCreditNote(draft: CreditNoteDraftPayload): Promise<Result<IssuedCreditNote>> {
  const parsed = CreditNoteDraftSchema.safeParse(draft);
  if (!parsed.success) return Promise.resolve({ success: false, error: parsed.error.issues[0]?.message ?? 'neispravni podaci', code: 'VALIDATION' });
  return call('issue_credit_note', IssuedCreditNoteSchema, { draft: parsed.data });
}

/** Reverse a wrongly booked payment by a counter-entry (S4). */
export function reversePayment(input: z.input<typeof PaymentReversalSchema>): Promise<Result<null>> {
  const parsed = PaymentReversalSchema.safeParse(input);
  if (!parsed.success) return Promise.resolve({ success: false, error: parsed.error.issues[0]?.message ?? 'neispravni podaci', code: 'VALIDATION' });
  return call('reverse_payment', z.null(), parsed.data);
}

/** Move family credit to an open invoice of the same family and institution, or record a refund (S3). */
export function moveCredit(input: z.input<typeof CreditMoveSchema>): Promise<Result<null>> {
  const parsed = CreditMoveSchema.safeParse(input);
  if (!parsed.success) return Promise.resolve({ success: false, error: parsed.error.issues[0]?.message ?? 'neispravni podaci', code: 'VALIDATION' });
  return call('move_credit', z.null(), parsed.data);
}

/** Link a credit note imported from the old workbook to the invoice it cancels (S5). */
export function linkLegacyCreditNote(creditNoteId: string, invoiceId: string): Promise<Result<null>> {
  return call('link_legacy_credit_note', z.null(), { creditNoteId, invoiceId });
}

export function listFamilyCredit(familyId: string): Promise<Result<FamilyCredit[]>> {
  return call('list_family_credit', FamilyCreditSchema, { familyId });
}
