import { kmToFenings, MoneyError, sum, type Fenings } from '@/features/billing/money';
import type { FamilyDetail } from '@/features/families/types';
import { PROGRAM_ENTITY, type LegalEntityCode } from '@/features/price-lists/types';
import { monthBounds, schoolYearOfMonth } from './domain';
import type { BillingMonth, InvoiceDraft, InvoiceLine } from './types';

/**
 * Manual invoice „Novi račun“ (specs/manual-invoice, F2; document `vNew`, `saveNewInvoice`).
 * A service outside the price list, for one child of one institution: lines of description, unit, whole quantity
 * and unit price, a mandatory basis (M11), no discount (BR-7: only with a board-decision record).
 * Price-list items are never entered here: they are billed by the monthly bulk (BR-26) or the enrolment-fee
 * invoice (BR-9, BR-10). Pure function; the backend checks the same rules again.
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

  const enrolment =
    child && input.month
      ? (() => {
          const schoolYear = schoolYearOfMonth(input.month);
          const { from, to } = monthBounds(input.month);
          const candidates = detail.enrolments.filter(
            (e) => e.childId === child.id && e.schoolYear === schoolYear && PROGRAM_ENTITY[e.program] === input.entity && e.status !== 'WITHDRAWN',
          );
          // prefer the enrolment that covers the month; any other of that school year still names the program
          return candidates.find((e) => e.startsOn <= to && (e.endsOn === null || e.endsOn >= from)) ?? candidates[0] ?? null;
        })()
      : null;
  if (child && input.month && !enrolment) {
    errors.push(`Dijete nema upis u ${input.entity} za školsku godinu ${schoolYearOfMonth(input.month)} — račun ${input.entity} se izdaje samo za dijete te ustanove.`);
  }

  const lines: InvoiceLine[] = [];
  input.rows.forEach((row, index) => {
    if (isEmptyRow(row)) return;
    const n = index + 1;
    const { quantity, unitPrice, total } = rowTotal(row);
    if (!row.description.trim()) errors.push(`Red ${n}: Unesite naziv usluge/stavke.`);
    if (quantity === null) errors.push(`Red ${n}: Količina mora biti cijeli broj od 1 do ${MAX_QUANTITY}.`);
    if (unitPrice === null) errors.push(`Red ${n}: Cijena mora biti iznos u KM (najviše dvije decimale) i ne može biti negativna.`);
    if (child && enrolment && row.description.trim() && quantity !== null && total !== null) {
      lines.push({
        itemCode: 'OTHER',
        description: row.description.trim(),
        childId: child.id,
        enrolmentId: enrolment.id,
        program: enrolment.program,
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

  if (errors.length > 0 || !child || !buyer || !enrolment || !input.month) return { ok: false, errors };
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
