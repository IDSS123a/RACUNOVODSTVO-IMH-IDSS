import { formatKM, sum, type Fenings } from '@/features/billing/money';

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
  /** Customer balance as on a customer ledger card: charged − paid. Positive = owes, negative = prepayment (u pretplati). */
  readonly saldo: Fenings;
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
  return { total: invoice.total, credited: invoice.credited, net, paid: invoice.paid, open, credit, saldo: net - invoice.paid, status };
}

/**
 * What the operator must confirm before a payment is recorded (Director, 2026-11-28: the same 1.000 KM was booked twice
 * on IMH-897/26, hours apart, without a word). An overpayment is real money and stays possible — it becomes family
 * credit (DL-P011) — but it is never recorded silently.
 * @param open    what is still to pay on the invoice
 * @param amount  the payment being entered (fenings); 0 or less = nothing to say yet
 * @param paidOn  its date (ISO)
 * @param payments the payments already on the invoice; reversed ones do not count
 */
export function paymentWarnings(
  open: Fenings,
  amount: Fenings,
  paidOn: string,
  payments: ReadonlyArray<{ readonly paidOn: string; readonly amount: Fenings; readonly reversedOn?: string | null }>,
): string[] {
  if (amount <= 0) return [];
  const warnings: string[] = [];
  if (open === 0) warnings.push(`Račun je već plaćen u cijelosti. Cijela uplata od ${formatKM(amount)} biće pretplata porodice (saldo ${formatKM(-amount)}).`);
  else if (amount > open)
    warnings.push(`Iznos je veći od preostalog (${formatKM(open)}) za ${formatKM(amount - open)}; taj višak biće pretplata porodice.`);
  const same = payments.filter((p) => !p.reversedOn && p.amount === amount);
  const sameDay = same.filter((p) => p.paidOn === paidOn);
  if (sameDay.length > 0)
    warnings.push(`Uplata od ${formatKM(amount)} s datumom ${paidOn.split('-').reverse().join('.')}. je već evidentirana na ovom računu. Provjerite da je ne unosite dva puta.`);
  else if (same.length > 0) warnings.push(`Uplata od ${formatKM(amount)} je već evidentirana na ovom računu (drugi datum). Provjerite da je ne unosite dva puta.`);
  return warnings;
}

/**
 * What the operator must confirm before a payment WITHOUT an invoice is recorded (specs/family-advance §2):
 * an unpaid invoice of the child in that institution (the money is probably for it), and the same payment again.
 */
export function prepaymentWarnings(
  amount: Fenings,
  paidOn: string,
  openInvoices: ReadonlyArray<{ readonly number: string; readonly open: Fenings }>,
  earlier: ReadonlyArray<{ readonly paidOn: string; readonly amount: Fenings; readonly reversedOn?: string | null }>,
): string[] {
  if (amount <= 0) return [];
  const warnings = openInvoices.map(
    (i) => `Dijete ima neplaćen račun ${i.number} (otvoreno ${formatKM(i.open)}). Ako je uplata za taj račun, evidentirajte je na tom računu, ne kao pretplatu.`,
  );
  if (earlier.some((p) => !p.reversedOn && p.amount === amount && p.paidOn === paidOn))
    warnings.push(`Uplata bez računa od ${formatKM(amount)} s datumom ${paidOn.split('-').reverse().join('.')}. je već evidentirana za ovo dijete. Provjerite da je ne unosite dva puta.`);
  return warnings;
}

export const BALANCE_LABEL: Readonly<Record<BalanceStatus, string>> = {
  OPEN: 'Otvoren',
  PARTIALLY_PAID: 'Djelimično plaćen',
  PAID: 'Plaćen',
  OVERPAID: 'Plaćen · višak u pretplati',
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

/**
 * Saldo as on a customer ledger card (Director, 2026-11-28: „nema zaduženja a korisnik plati = u pretplati“):
 * charged (invoices net of credit notes) − paid. Positive: the customer owes; negative: prepayment; zero: settled.
 */
export function saldoLabel(saldo: Fenings): string {
  return saldo > 0 ? 'duguje' : saldo < 0 ? 'u pretplati' : 'izmireno';
}

/** „−1.000,00 KM (u pretplati)“ — the signed saldo with its meaning. */
export function saldoText(saldo: Fenings): string {
  return `${formatKM(saldo)} (${saldoLabel(saldo)})`;
}
