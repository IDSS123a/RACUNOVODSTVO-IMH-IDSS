import { kmToFenings, MoneyError, sum, type Fenings } from '@/features/billing/money';
import type { FamilyDetail } from '@/features/families/types';
import { PROGRAM_ENTITY, type LegalEntityCode } from '@/features/price-lists/types';
import { monthBounds, schoolYearOfMonth } from './domain';
import type { BillingMonth, InvoiceDraft, InvoiceLine } from './types';

/**
 * Manual invoice „Novi račun“ (specs/manual-invoice, F2; document `vNew`, `saveNewInvoice`; Director 2026-11-21).
 * Only for services used temporarily by a child NOT regularly enrolled in the institution (e.g. summer school only):
 * lines of description, unit, whole quantity and unit price, a mandatory basis (M11), no discount (BR-7).
 * Everything else of a child — tuition, one-time items, extra services — goes on its one monthly invoice
 * (`monthly.ts`). Pure function; the backend checks the same rules again.
 */

export type ManualUnit = 'kom' | 'srv';

/** One form row, as typed. */
export interface ManualRowInput {
  readonly description: string;
  readonly unit: ManualUnit;
  readonly quantity: string;
  readonly unitPrice: string;
}

export interface ManualInvoiceInput {
  readonly entity: LegalEntityCode;
  readonly childId: string;
  readonly month: BillingMonth | '';
  readonly issueDate: string;
  readonly dueDate: string;
  readonly reason: string;
  readonly rows: ReadonlyArray<ManualRowInput>;
}

/** A row's computed values, for the live totals of the form. Null fields mean "not a valid number yet". */
export interface ManualRowTotal {
  readonly quantity: number | null;
  readonly unitPrice: Fenings | null;
  readonly total: Fenings | null;
}

export type ManualInvoiceResult =
  | { readonly ok: true; readonly draft: InvoiceDraft & { readonly reason: string } }
  | { readonly ok: false; readonly errors: ReadonlyArray<string> };

export const MAX_QUANTITY = 999;

/**
 * Whether an existing invoice means "this child is already invoiced this month" for the monthly bulk.
 * A manual invoice of the app (kind OTHER, source APP) never does: summer school must not stop the August tuition.
 * Imported invoices (also OTHER, but LEGACY) do (BR-32).
 */
export function countsAsMonthlyBilled(invoice: {
  readonly status: string;
  readonly kind: string;
  readonly source: string;
  readonly childId: string;
}): boolean {
  if (invoice.status !== 'ISSUED' || invoice.kind === 'CREDIT_NOTE' || !invoice.childId) return false;
  return !(invoice.kind === 'OTHER' && invoice.source === 'APP');
}

/** Whole quantity 1–999, or null. */
export function parseQuantity(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= 1 && value <= MAX_QUANTITY ? value : null;
}

/** Unit price in fenings (≥ 0, at most two decimals, „150,50“ or „150.50“), or null. */
export function parsePrice(text: string): Fenings | null {
  if (text.trim() === '') return null;
  try {
    const value = kmToFenings(text);
    return value >= 0 && Number.isSafeInteger(value) ? value : null;
  } catch (error: unknown) {
    if (error instanceof MoneyError) return null;
    throw error;
  }
}

export function rowTotal(row: ManualRowInput): ManualRowTotal {
  const quantity = parseQuantity(row.quantity);
  const unitPrice = parsePrice(row.unitPrice);
  return { quantity, unitPrice, total: quantity !== null && unitPrice !== null ? quantity * unitPrice : null };
}

const isEmptyRow = (row: ManualRowInput): boolean => !row.description.trim() && !row.quantity.trim() && !row.unitPrice.trim();

/**
 * Validate the form and build the draft. Messages follow the document's wording (M5).
 * @param detail the family of the chosen child
 */
export function buildManualInvoice(detail: FamilyDetail, input: ManualInvoiceInput): ManualInvoiceResult {
  const errors: string[] = [];
  const child = detail.children.find((c) => c.id === input.childId);
  if (!child) errors.push('Odaberite dijete.');
  const buyer = detail.guardians.find((g) => g.isPayer);
  if (!buyer) errors.push(`Porodica „${detail.family.displayName}“ nema kupca na računu — odredite ga u kartici porodice.`);
  if (!detail.family.address.trim()) errors.push('Adresa kupca ne može biti prazna — unesite je u kartici porodice.');
  if (!input.month) errors.push('Odaberite obračunski mjesec.');
  if (!input.issueDate) errors.push('Unesite datum izdavanja računa.');
  if (!input.dueDate) errors.push('Unesite rok plaćanja računa.');
  if (input.issueDate && input.dueDate && input.dueDate < input.issueDate) errors.push('Rok plaćanja ne može biti prije datuma izdavanja.');
  if (!input.reason.trim()) errors.push('Unesite osnov računa (odluka, ugovor ili obavijest).');

  // Director, 2026-11-21: only for a child NOT regularly enrolled in the institution that school year (e.g. it attends
  // only the summer school). An enrolled child's extra services go on its monthly invoice (one invoice per child).
  const enrolled =
    child && input.month
      ? detail.enrolments.some(
          (e) =>
            e.childId === child.id &&
            e.schoolYear === schoolYearOfMonth(input.month as BillingMonth) &&
            PROGRAM_ENTITY[e.program] === input.entity &&
            e.status !== 'WITHDRAWN',
        )
      : false;
  if (child && input.month && enrolled) {
    errors.push(
      `Dijete je redovno upisano u ${input.entity} (${schoolYearOfMonth(input.month)}) — dodatne usluge idu na njegov mjesečni račun („Mjesečni računi“ → „Dodaj uslugu van cjenovnika“).`,
    );
  }

  const lines: InvoiceLine[] = [];
  input.rows.forEach((row, index) => {
    if (isEmptyRow(row)) return;
    const n = index + 1;
    const { quantity, unitPrice, total } = rowTotal(row);
    if (!row.description.trim()) errors.push(`Red ${n}: Unesite naziv usluge/stavke.`);
    if (quantity === null) errors.push(`Red ${n}: Količina mora biti cijeli broj od 1 do ${MAX_QUANTITY}.`);
    if (unitPrice === null) errors.push(`Red ${n}: Cijena mora biti iznos u KM (najviše dvije decimale) i ne može biti negativna.`);
    if (child && !enrolled && row.description.trim() && quantity !== null && total !== null) {
      lines.push({
        itemCode: 'OTHER',
        description: row.description.trim(),
        childId: child.id,
        // a child not enrolled in the institution: the line has no enrolment and no program
        enrolmentId: '',
        program: '',
        listAmount: total,
        boardDecisionId: null,
        amount: total,
        quantity,
        unit: row.unit,
      });
    }
  });
  if (input.rows.every(isEmptyRow)) errors.push('Unesite barem jednu ispravnu stavku na račun (naziv, količina > 0 i cijena).');
  const invoiceTotal = sum(lines.map((l) => l.amount));
  if (lines.length > 0 && invoiceTotal <= 0) errors.push('Ukupan iznos računa mora biti veći od 0 KM.');

  if (errors.length > 0 || !child || !buyer || !input.month) return { ok: false, errors };
  const { from, to } = monthBounds(input.month);
  return {
    ok: true,
    draft: {
      entity: input.entity,
      familyId: detail.family.id,
      childId: child.id,
      childName: `${child.firstName} ${child.lastName}`,
      buyerName: buyer.fullName,
      buyerAddress: detail.family.address,
      issueDate: input.issueDate,
      dueDate: input.dueDate,
      periodFrom: from,
      periodTo: to,
      lines,
      total: invoiceTotal,
      reason: input.reason.trim(),
    },
  };
}
