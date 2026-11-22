import { normalizeUnit } from '@/lib/validation/formats';
import { kmToFenings, MoneyError, sum, type Fenings } from '@/features/billing/money';
import type { FamilyDetail } from '@/features/families/types';
import type { LegalEntityCode } from '@/features/price-lists/types';
import { monthBounds } from './domain';
import type { BillingMonth, InvoiceDraft, InvoiceLine } from './types';

/**
 * Invoice for other services — anything not in the price list: summer school, section, trip … (DEFINICIJA-APLIKACIJE,
 * Director 2026-11-21) — for any child, enrolled or not, on its own invoice: lines of description, unit, whole
 * quantity and unit price, a mandatory basis, no discount (BR-7). The lines carry no enrolment. Price-list items are
 * on the monthly invoice (`monthly.ts`). Pure function; the backend checks the same rules again.
 */

/** Unit of measure of a line: one of the proposals or any other short unit (`normalizeUnit`). */
export type ManualUnit = string;

/** Text of a service for comparison — the same rule as the backend (`service_key`): lower case, single spaces. */
export function serviceKey(description: string): string {
  return description.trim().split(/\s+/).join(' ').toLowerCase();
}

/** Units proposed for a line; any other short unit may be typed (Director, 2026-11-22). */
export const UNIT_PROPOSALS: ReadonlyArray<{ unit: string; label: string }> = [
  { unit: 'srv', label: 'usluga' },
  { unit: 'kom', label: 'komad' },
  { unit: 'sedm.', label: 'sedmica' },
  { unit: 'dan', label: 'dan' },
  { unit: 'mj.', label: 'mjesec' },
  { unit: 'čas', label: 'čas' },
];

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
  // an imported invoice counts whatever it is; of the app's own only the monthly ones (an enrolment invoice has the
  // school year as its period and must not stop the September invoice; a manual one is for children not enrolled)
  if (invoice.source === 'LEGACY') return true;
  return invoice.kind === 'MONTHLY' || invoice.kind === 'INSTALMENT';
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

  // Director 2026-11-21 (DEFINICIJA): other services (summer school, section, trip …) may be invoiced to ANY child,
  // enrolled or not, on their own invoice; the monthly invoice keeps the price-list items only.

  const lines: InvoiceLine[] = [];
  input.rows.forEach((row, index) => {
    if (isEmptyRow(row)) return;
    const n = index + 1;
    const { quantity, unitPrice, total } = rowTotal(row);
    if (!row.description.trim()) errors.push(`Red ${n}: Unesite naziv usluge/stavke.`);
    if (quantity === null) errors.push(`Red ${n}: Količina mora biti cijeli broj od 1 do ${MAX_QUANTITY}.`);
    if (unitPrice === null) errors.push(`Red ${n}: Cijena mora biti iznos u KM (najviše dvije decimale) i ne može biti negativna.`);
    const unit = normalizeUnit(row.unit);
    if (unit === null) errors.push(`Red ${n}: Jedinica mjere je kratka riječ (npr. srv, kom, sedm.), najviše 10 slova.`);
    if (child && row.description.trim() && quantity !== null && total !== null && unit !== null) {
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
        unit,
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
