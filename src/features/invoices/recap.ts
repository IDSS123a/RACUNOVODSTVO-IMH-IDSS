import { sum, type Fenings } from '@/features/billing/money';

/**
 * Invoice table rows and recapitulation, as on the institutions' invoice (F1 / SPEC C5, C7;
 * sample `Faktura_IMH_004_26.pdf`). Every amount is integer fenings (BR-8) and comes from here only (M-7):
 * - Cijena = the amount by the price list, S rabatom = the invoiced amount, Rabat = their difference;
 * - PDV is 0 % (the institutions are not PDV payers — the exemption note is printed beside the recap);
 * - Prodajna vrijednost − Iznos odobrenog rabata = Vrijednost bez PDV = UKUPNO ZA UPLATU.
 */

/** Unit of measure as in the document's price list: `kom` for one-time items, `srv` for services. */
const ONE_TIME_ITEMS = new Set(['ENROLMENT_FEE', 'ENROLMENT_FEE_AFTER_IDSS_PRESCHOOL', 'MATERIALS', 'DEPOSIT']);

export interface RecapLine {
  readonly position: number;
  readonly description: string;
  readonly unit: 'kom' | 'srv';
  readonly quantity: number;
  /** Price by the price list. */
  readonly price: Fenings;
  /** Invoiced amount after any discount. */
  readonly discounted: Fenings;
  /** Discount in basis points of the price (informational; the fening amounts are exact). */
  readonly discountBp: number;
  readonly vatPercent: 0;
  readonly vat: Fenings;
  readonly netAmount: Fenings;
}

export interface InvoiceRecap {
  readonly lines: ReadonlyArray<RecapLine>;
  /** Prodajna vrijednost: Σ price-list amounts. */
  readonly salesValue: Fenings;
  /** Iznos odobrenog rabata: sales value − value without PDV. */
  readonly discount: Fenings;
  /** Vrijednost bez PDV. */
  readonly netValue: Fenings;
  /** Iznos PDV (0 %). */
  readonly vat: Fenings;
  /** UKUPNO ZA UPLATU (before credit notes and payments). */
  readonly total: Fenings;
}

/**
 * Rows and recapitulation of an invoice.
 * @param lines stored lines in position order: item code, description, price-list amount and invoiced amount
 */
export function invoiceRecap(
  lines: ReadonlyArray<{ readonly itemCode: string; readonly description: string; readonly listAmount: Fenings; readonly amount: Fenings }>,
): InvoiceRecap {
  const rows: RecapLine[] = lines.map((line, index) => {
    const discountBp = line.listAmount > 0 ? Math.round(((line.listAmount - line.amount) * 10000) / line.listAmount) : 0;
    return {
      position: index + 1,
      description: line.description,
      unit: ONE_TIME_ITEMS.has(line.itemCode) ? 'kom' : 'srv',
      quantity: 1,
      price: line.listAmount,
      discounted: line.amount,
      discountBp,
      vatPercent: 0,
      vat: 0,
      netAmount: line.amount,
    };
  });
  const salesValue = sum(rows.map((r) => r.price));
  const netValue = sum(rows.map((r) => r.netAmount));
  return { lines: rows, salesValue, discount: salesValue - netValue, netValue, vat: 0, total: netValue };
}

/** Discount in basis points as printed: "0%", "4,23%", "12,5%". */
export function formatDiscount(bp: number): string {
  const value = bp / 100;
  const text = Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0$/, '');
  return `${text.replace('.', ',')}%`;
}
