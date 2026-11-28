import { z } from 'zod';
import { call, type Result } from '@/lib/tauri/invoke';
import {
  InvoiceDetailSchema,
  InvoiceDraftSchema,
  InvoiceSummariesSchema,
  PaymentPlanSchema,
  PaymentPlansSchema,
  PaymentSchema,
  CreditNoteDraftSchema,
  IssuedCreditNoteSchema,
  PaymentReversalSchema,
  ChildBalanceSchema,
  NamedBalanceSchema,
  PrepaidSourceSchema,
  PrepaymentInputSchema,
  PrepaymentRowSchema,
  PrepaymentUseSchema,
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

/** A service outside the price list already on an issued invoice of the month (no double billing, 2026-11-22). */
export const BilledServiceSchema = z.object({ childId: z.string(), description: z.string(), invoiceNumber: z.string() });
export type BilledService = z.infer<typeof BilledServiceSchema>;

/** Services outside the price list on issued invoices of an institution and month (`periodFrom` = first day). */
export function listBilledServices(entity: LegalEntityCode, periodFrom: string): Promise<Result<BilledService[]>> {
  return call('list_billed_services', z.array(BilledServiceSchema), { entity, periodFrom });
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

/** Link a credit note imported from the old workbook to the invoice it cancels (S5). */
export function linkLegacyCreditNote(creditNoteId: string, invoiceId: string): Promise<Result<null>> {
  return call('link_legacy_credit_note', z.null(), { creditNoteId, invoiceId });
}

// ---------- Child prepayment (specs/family-advance, migration 016) ----------

export type ChildBalance = z.infer<typeof ChildBalanceSchema>;
export type PrepaymentRow = z.infer<typeof PrepaymentRowSchema>;
export type PrepaymentUse = z.infer<typeof PrepaymentUseSchema>;
export type PrepaidSource = z.infer<typeof PrepaidSourceSchema>;
export type PrepaymentInput = z.infer<typeof PrepaymentInputSchema>;

/** Every child's ledger card of a family, per institution — the one definition is in the backend (M-7). */
export function listChildBalances(familyId: string): Promise<Result<ChildBalance[]>> {
  return call('list_child_balances', z.array(ChildBalanceSchema), { familyId });
}

export type NamedBalance = z.infer<typeof NamedBalanceSchema>;

/** Every child's card of every family, optionally of one institution (reports, step E). */
export function listAllChildBalances(entity: LegalEntityCode | null): Promise<Result<NamedBalance[]>> {
  return call('list_all_child_balances', z.array(NamedBalanceSchema), { entity });
}

export function listPrepayments(familyId: string): Promise<Result<PrepaymentRow[]>> {
  return call('list_prepayments', z.array(PrepaymentRowSchema), { familyId });
}

export function listPrepaidSources(familyId: string, entity: LegalEntityCode, childId: string | null): Promise<Result<PrepaidSource[]>> {
  return call('list_prepaid_sources', z.array(PrepaidSourceSchema), { familyId, entity, childId });
}

/** Prepaid money used on an invoice (positive) or taken from its excess (negative). */
export function listInvoicePrepaymentUses(invoiceId: string): Promise<Result<PrepaymentUse[]>> {
  return call('list_invoice_prepayment_uses', z.array(PrepaymentUseSchema), { invoiceId });
}

/** A payment without an invoice for one child in one institution (BR-24, Q1). */
export function recordPrepayment(input: PrepaymentInput): Promise<Result<null>> {
  const parsed = PrepaymentInputSchema.safeParse(input);
  if (!parsed.success) return Promise.resolve({ success: false, error: parsed.error.issues[0]?.message ?? 'neispravni podaci', code: 'VALIDATION' });
  return call('record_prepayment', z.null(), { prepayment: parsed.data });
}

/** Use a child's prepaid money on an invoice, or refund it (`invoiceId` null). A brother's or sister's invoice needs `sibling`. */
export function applyPrepaid(input: {
  familyId: string;
  entity: LegalEntityCode;
  childId: string | null;
  invoiceId: string | null;
  amount: number;
  usedOn: string;
  note: string;
  sibling: boolean;
}): Promise<Result<null>> {
  return call('use_prepaid', z.null(), input);
}

export function reversePrepayment(prepaymentId: string, reversedOn: string, reason: string): Promise<Result<null>> {
  return call('reverse_prepayment', z.null(), { prepaymentId, reversedOn, reason });
}

export function reversePrepaymentUse(useId: string, reversedOn: string, reason: string): Promise<Result<null>> {
  return call('reverse_prepayment_use', z.null(), { useId, reversedOn, reason });
}
