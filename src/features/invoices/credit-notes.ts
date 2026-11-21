import { sum, type Fenings } from '@/features/billing/money';

/**
 * Storno, credit notes and payment correction — pure domain (specs/storno-credit-notes, Director S1–S6).
 * The effective balance mirrors the backend definition (credit_notes::NET_SQL / PAID_SQL, M-7):
 * - net  = total + Σ credit notes linked to the invoice (credit notes are negative);
 * - paid = payments without a reversal + credit moved in − credit moved out (the backend sends it ready);
 * - open = max(0, net − paid), credit = max(0, paid − net).
 */

export class CreditNoteError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CreditNoteError';
  }
}

export type BalanceStatus = 'OPEN' | 'PARTIALLY_PAID' | 'PAID' | 'OVERPAID' | 'CANCELLED';

export interface InvoiceBalance {
  readonly total: Fenings;
  readonly credited: Fenings;
  readonly net: Fenings;
  readonly paid: Fenings;
  readonly open: Fenings;
  readonly credit: Fenings;
  readonly status: BalanceStatus;
}

/**
 * Effective balance of an invoice.
 * @param invoice total (original), credited (Σ credit notes, ≤ 0) and effective paid, as the backend reports them
 */
export function invoiceBalance(invoice: { readonly total: Fenings; readonly credited: Fenings; readonly paid: Fenings }): InvoiceBalance {
  const net = invoice.total + invoice.credited;
  const open = Math.max(0, net - invoice.paid);
  const credit = Math.max(0, invoice.paid - net);
  const status: BalanceStatus =
    invoice.credited < 0 && net === 0
      ? 'CANCELLED'
      : invoice.paid === 0
        ? 'OPEN'
        : invoice.paid < net
          ? 'PARTIALLY_PAID'
          : invoice.paid === net
            ? 'PAID'
            : 'OVERPAID';
  return { total: invoice.total, credited: invoice.credited, net, paid: invoice.paid, open, credit, status };
}

export const BALANCE_LABEL: Readonly<Record<BalanceStatus, string>> = {
  OPEN: 'Otvoren',
  PARTIALLY_PAID: 'Djelimično plaćen',
  PAID: 'Plaćen',
  OVERPAID: 'Preplaćen (kredit)',
  CANCELLED: 'Storniran',
};

export interface CreditableLine {
  readonly position: number;
  readonly description: string;
  /** The original line amount. */
  readonly amount: Fenings;
  /** What may still be credited on this line (original amount + already credited, ≥ 0). */
  readonly remaining: Fenings;
}

/**
 * The lines of an invoice with what may still be credited on each (S2). Lines with a zero or negative
 * amount (e.g. imported scholarships) are not creditable.
 * @param lines original lines in position order (position = index + 1)
 * @param credited already credited per position (≤ 0), as the backend reports it
 */
export function creditableLines(
  lines: ReadonlyArray<{ readonly description: string; readonly amount: Fenings }>,
  credited: ReadonlyArray<{ readonly position: number; readonly amount: Fenings }>,
): CreditableLine[] {
  const byPosition = new Map(credited.map((c) => [c.position, c.amount]));
  return lines.map((line, index) => {
    const position = index + 1;
    const remaining = line.amount > 0 ? Math.max(0, line.amount + (byPosition.get(position) ?? 0)) : 0;
    return { position, description: line.description, amount: line.amount, remaining };
  });
}

/** The operator's choice: cancel everything still open on the invoice, or chosen amounts per line. */
export type CreditSelection = { readonly kind: 'WHOLE' } | { readonly kind: 'LINES'; readonly amounts: ReadonlyMap<number, Fenings> };

/**
 * Credit-note lines (negative amounts) from the operator's choice. Throws when nothing is selected
 * or an amount exceeds what remains on its line — the backend checks the same again.
 */
export function creditNoteLines(lines: ReadonlyArray<CreditableLine>, selection: CreditSelection): Array<{ position: number; amount: Fenings }> {
  const chosen =
    selection.kind === 'WHOLE'
      ? lines.filter((l) => l.remaining > 0).map((l) => ({ position: l.position, credit: l.remaining }))
      : [...selection.amounts].filter(([, credit]) => credit !== 0).map(([position, credit]) => ({ position, credit }));
  if (chosen.length === 0) throw new CreditNoteError('na računu nema ništa za odobriti — odaberite barem jednu stavku');
  return chosen
    .sort((a, b) => a.position - b.position)
    .map(({ position, credit }) => {
      const line = lines.find((l) => l.position === position);
      if (!line) throw new CreditNoteError(`račun nema stavku ${position}`);
      if (!Number.isSafeInteger(credit) || credit <= 0) throw new CreditNoteError(`stavka ${position}: iznos mora biti veći od nule`);
      if (credit > line.remaining) throw new CreditNoteError(`stavka ${position}: može se odobriti najviše ${line.remaining / 100} KM`);
      return { position, amount: -credit };
    });
}

/** Total of a credit note (negative). */
export function creditNoteTotal(lines: ReadonlyArray<{ readonly amount: Fenings }>): Fenings {
  return sum(lines.map((l) => l.amount));
}

/** Family credit per institution from the backend list (S3; entities are never mixed). */
export function creditByEntity(rows: ReadonlyArray<{ readonly entity: string; readonly credit: Fenings }>): Map<string, Fenings> {
  const out = new Map<string, Fenings>();
  for (const r of rows) out.set(r.entity, (out.get(r.entity) ?? 0) + r.credit);
  return out;
}
