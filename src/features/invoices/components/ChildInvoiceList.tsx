import { FileTextIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { formatKM } from '@/features/billing/money';
import { formatDate } from '@/lib/format';
import { BALANCE_LABEL } from '../credit-notes';
import { monthLabel } from '../domain';
import { openSummary, type ChildInvoiceRow } from '../family-invoices';
import type { BillingMonth } from '../types';

/**
 * The child's invoices under its saldo on the family card (Director, 2026-11-28): every invoice, the cancelled ones
 * too, with its credit notes. A click opens the invoice (payment, credit note, remainder notice); „PDF“ shows it.
 * Folded when nothing is open, so the card stays short.
 */
export function ChildInvoiceList({
  rows,
  onOpen,
  onPdf,
}: {
  rows: ReadonlyArray<ChildInvoiceRow>;
  onOpen: (invoiceId: string) => void;
  onPdf: (invoiceId: string) => void;
}): React.JSX.Element | null {
  if (rows.length === 0) return null;
  const summary = openSummary(rows);
  return (
    <details open={summary.open > 0} className="mt-1">
      <summary className="cursor-pointer select-none text-foreground">
        Računi: {summary.count}
        {summary.open > 0 ? ` · otvoreno ${summary.open} (${formatKM(summary.openAmount)})` : ' · nijedan nije otvoren'}
      </summary>
      <ul className="mt-1 grid gap-1 pl-4">
        {rows.map(({ invoice, creditNotes, balance }) => (
          <li key={invoice.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <button type="button" className="font-medium text-foreground hover:underline" onClick={() => onOpen(invoice.id)} title="Otvori račun">
              {invoice.number}
            </button>
            <span>{monthLabel(invoice.periodFrom.slice(0, 7) as BillingMonth)}</span>
            <span className="tabular-nums">{formatKM(invoice.total)}</span>
            <Badge className="whitespace-nowrap" variant={balance.status === 'PAID' ? 'default' : balance.status === 'CANCELLED' ? 'secondary' : 'outline'}>
              {BALANCE_LABEL[balance.status]}
            </Badge>
            {balance.open > 0 && invoice.status === 'ISSUED' && <span className="tabular-nums text-destructive">ostalo {formatKM(balance.open)}</span>}
            {creditNotes.map((c) => (
              <button key={c.id} type="button" className="hover:underline" onClick={() => onOpen(c.id)} title="Otvori knjižno odobrenje">
                {c.number} {formatKM(c.total)} ({formatDate(c.issueDate)})
              </button>
            ))}
            <Button variant="ghost" size="sm" className="h-7 px-2" onClick={() => onPdf(invoice.id)}>
              <FileTextIcon aria-hidden /> PDF
            </Button>
          </li>
        ))}
      </ul>
    </details>
  );
}
