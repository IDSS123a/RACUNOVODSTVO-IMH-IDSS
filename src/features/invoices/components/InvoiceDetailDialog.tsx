import { useCallback, useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { FileTextIcon } from 'lucide-react';
import { toast } from 'sonner';
import { ErrorBlock, LoadingBlock } from '@/components/feedback';
import { FormDialog } from '@/components/form-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatKM, kmToFenings, MoneyError } from '@/features/billing/money';
import { Field } from '@/features/settings/components/OperatorForm';
import { formatDate } from '@/lib/format';
import { useAsyncResult } from '@/lib/use-async-result';
import { z } from 'zod';
import { BALANCE_LABEL, invoiceBalance } from '../credit-notes';
import { getInvoice, recordPayment, reversePayment, type InvoiceDetail, type Payment } from '../repository';
import { CreditMovePanel } from './CreditMovePanel';
import { CreditNotePanel } from './CreditNotePanel';

const PaymentFormSchema = z.object({
  paidOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'unesite datum'),
  amountKm: z.string().refine((value) => {
    try {
      return kmToFenings(value) > 0;
    } catch (error: unknown) {
      if (error instanceof MoneyError) return false;
      throw error;
    }
  }, 'unesite iznos, npr. 710,00'),
  payerName: z.string().trim().min(1, 'unesite ko je uplatio'),
  reference: z.string().trim(),
});
type PaymentForm = z.infer<typeof PaymentFormSchema>;

/**
 * Invoice detail: lines, credit notes, payments, effective balance, "record payment" (any family member may pay),
 * and the storno actions — credit note, payment reversal, credit move / refund (specs/storno-credit-notes).
 */
export function InvoiceDetailDialog({
  invoiceId,
  onClose,
  onChanged,
  onShowPdf,
}: {
  invoiceId: string | null;
  onClose: () => void;
  onChanged: () => void;
  onShowPdf: (invoiceId: string) => void;
}): React.JSX.Element {
  return (
    <FormDialog open={invoiceId !== null} onOpenChange={(open) => !open && onClose()} title="Račun" wide>
      {invoiceId && <InvoiceBody invoiceId={invoiceId} onChanged={onChanged} onShowPdf={onShowPdf} />}
    </FormDialog>
  );
}

function InvoiceBody({ invoiceId, onChanged, onShowPdf }: { invoiceId: string; onChanged: () => void; onShowPdf: (invoiceId: string) => void }): React.JSX.Element {
  const load = useCallback(() => getInvoice(invoiceId), [invoiceId]);
  const detail = useAsyncResult(load);
  if (detail.state.status === 'loading') return <LoadingBlock />;
  if (detail.state.status === 'error') return <ErrorBlock message={detail.state.error} onRetry={detail.reload} />;
  const data = detail.state.data;
  // key: re-mount after every change so defaults (open amount, panels) reflect the new balance
  return (
    <InvoiceContent
      key={`${data.payments.length}|${data.payments.filter((p) => p.reversedOn).length}|${data.creditNotes.length}|${data.invoice.paid}`}
      detail={data}
      onShowPdf={() => onShowPdf(invoiceId)}
      onPaid={() => {
        detail.reload();
        onChanged();
      }}
    />
  );
}

function InvoiceContent({ detail, onPaid, onShowPdf }: { detail: InvoiceDetail; onPaid: () => void; onShowPdf: () => void }): React.JSX.Element {
  const { invoice, lines, payments, creditNotes } = detail;
  // Effective balance from the backend: reversed payments and moved credit are already accounted for.
  const summary = invoiceBalance(invoice);
  const [showCreditNote, setShowCreditNote] = useState(false);
  const isCreditNote = invoice.kind === 'CREDIT_NOTE';
  const canCredit = !isCreditNote && invoice.status === 'ISSUED' && summary.net > 0;
  const canPay = !isCreditNote && invoice.status === 'ISSUED';
  const form = useForm<PaymentForm>({
    resolver: zodResolver(PaymentFormSchema),
    defaultValues: {
      paidOn: new Date().toISOString().slice(0, 10),
      amountKm: formatKM(summary.open).replace(' KM', ''),
      payerName: invoice.buyerName,
      reference: '',
    },
  });
  const { errors, isSubmitting } = form.formState;

  async function submit(values: PaymentForm): Promise<void> {
    const result = await recordPayment({
      id: crypto.randomUUID(),
      invoiceId: invoice.id,
      paidOn: values.paidOn,
      amount: kmToFenings(values.amountKm),
      payerName: values.payerName,
      reference: values.reference,
      note: '',
    });
    if (result.success) {
      toast.success('Uplata je evidentirana.');
      onPaid();
    } else toast.error(result.error);
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xl font-semibold">{invoice.number}</p>
          <p className="text-sm text-muted-foreground">
            {invoice.childName ? `${invoice.childName} · ` : ''}kupac {invoice.buyerName} · {invoice.buyerAddress || 'bez adrese'}
          </p>
          <p className="text-sm text-muted-foreground">
            Izdat {formatDate(invoice.issueDate)} · rok {formatDate(invoice.dueDate)} · period {formatDate(invoice.periodFrom)} – {formatDate(invoice.periodTo)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={summary.status === 'PAID' ? 'default' : summary.status === 'CANCELLED' ? 'secondary' : 'outline'}>
            {isCreditNote ? 'Knjižno odobrenje' : BALANCE_LABEL[summary.status]}
          </Badge>
          <Button variant="outline" onClick={onShowPdf}>
            <FileTextIcon aria-hidden /> PDF / štampa
          </Button>
          {canCredit && !showCreditNote && (
            <Button variant="outline" onClick={() => setShowCreditNote(true)}>
              Knjižno odobrenje (storno)…
            </Button>
          )}
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Stavka</TableHead>
            <TableHead className="text-right">Po cjenovniku</TableHead>
            <TableHead className="text-right">Iznos</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line, index) => (
            <TableRow key={`${line.enrolmentId}-${index}`}>
              <TableCell>
                {line.description}
                {line.boardDecisionId && <span className="ml-2 text-xs text-muted-foreground">(odluka odbora)</span>}
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatKM(line.listAmount)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatKM(line.amount)}</TableCell>
            </TableRow>
          ))}
          <TableRow>
            <TableCell colSpan={2} className="font-medium">{isCreditNote ? 'Ukupno odobreno' : 'Ukupno'}</TableCell>
            <TableCell className="text-right font-semibold tabular-nums">{formatKM(invoice.total)}</TableCell>
          </TableRow>
          {creditNotes.map((cn) => (
            <TableRow key={cn.id}>
              <TableCell colSpan={2} className="text-sm">
                Knjižno odobrenje {cn.number} od {formatDate(cn.issueDate)}
                {cn.reason && <span className="text-muted-foreground"> · {cn.reason}</span>}
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatKM(cn.total)}</TableCell>
            </TableRow>
          ))}
          {creditNotes.length > 0 && (
            <TableRow>
              <TableCell colSpan={2} className="font-medium">Za uplatu nakon knjižnih odobrenja</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{formatKM(summary.net)}</TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>

      {isCreditNote && <CreditNoteOrigin creditsInvoiceId={invoice.creditsInvoiceId} reason={invoice.reason} />}

      {showCreditNote && <CreditNotePanel detail={detail} onCancel={() => setShowCreditNote(false)} onIssued={onPaid} />}

      {!isCreditNote && (
        <div className="grid gap-1 text-sm">
          <p>Uplaćeno: <strong className="tabular-nums">{formatKM(summary.paid)}</strong></p>
          <p>Preostalo: <strong className="tabular-nums">{formatKM(summary.open)}</strong></p>
          {summary.credit > 0 && <p>Kredit (višak uplate): <strong className="tabular-nums">{formatKM(summary.credit)}</strong></p>}
          {payments.map((p) => (
            <PaymentRow key={p.id} payment={p} onReversed={onPaid} />
          ))}
        </div>
      )}

      {!isCreditNote && summary.credit > 0 && <CreditMovePanel invoice={invoice} credit={summary.credit} onMoved={onPaid} />}

      {canPay && (
        <form className="grid gap-4 rounded-lg border p-4 md:grid-cols-4" onSubmit={form.handleSubmit(submit)} noValidate>
          <p className="text-sm font-medium md:col-span-4">Evidentiraj uplatu (uplatiti može bilo ko iz porodice)</p>
          <Field id="pay-date" label="Datum uplate" error={errors.paidOn?.message}>
            <Input id="pay-date" type="date" {...form.register('paidOn')} />
          </Field>
          <Field id="pay-amount" label="Iznos (KM)" error={errors.amountKm?.message}>
            <Input id="pay-amount" inputMode="decimal" {...form.register('amountKm')} aria-invalid={Boolean(errors.amountKm)} />
          </Field>
          <Field id="pay-payer" label="Uplatio/la" error={errors.payerName?.message}>
            <Input id="pay-payer" {...form.register('payerName')} />
          </Field>
          <Field id="pay-ref" label="Referenca (izvod)">
            <Input id="pay-ref" {...form.register('reference')} />
          </Field>
          <div className="md:col-span-4">
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? 'Spremanje…' : 'Evidentiraj uplatu'}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
}

/** One payment, with „Storno uplate“ (S4): a counter-entry with a reason; the payment itself stays visible. */
function PaymentRow({ payment, onReversed }: { payment: Payment; onReversed: () => void }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function reverse(): Promise<void> {
    setBusy(true);
    try {
      const result = await reversePayment({ paymentId: payment.id, reversedOn: new Date().toISOString().slice(0, 10), reason });
      if (!result.success) return void toast.error(result.error);
      toast.success('Uplata je stornirana protuknjiženjem.');
      onReversed();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="text-muted-foreground">
      <span className={payment.reversedOn ? 'line-through' : undefined}>
        {formatDate(payment.paidOn)} · {formatKM(payment.amount)} · uplatio/la {payment.payerName}
        {payment.reference ? ` · ${payment.reference}` : ''}
      </span>
      {payment.reversedOn && ` · stornirano ${formatDate(payment.reversedOn)}: ${payment.reversalReason ?? ''}`}
      {!payment.reversedOn && !open && (
        <Button variant="link" size="sm" className="h-auto px-2 py-0" onClick={() => setOpen(true)}>
          Storno uplate…
        </Button>
      )}
      {open && (
        <span className="mt-1 flex flex-wrap items-center gap-2">
          <Input
            aria-label="Razlog storna uplate"
            className="h-8 max-w-sm"
            maxLength={500}
            placeholder="Razlog (npr. uplata je za drugo dijete)"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
          <Button size="sm" variant="destructive" disabled={busy || !reason.trim()} onClick={() => void reverse()}>
            Storniraj uplatu
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setOpen(false)}>
            Odustani
          </Button>
        </span>
      )}
    </div>
  );
}

/** For a credit note: the invoice it cancels and the reason (legacy ones may still be unlinked — S5). */
function CreditNoteOrigin({ creditsInvoiceId, reason }: { creditsInvoiceId: string | null; reason: string }): React.JSX.Element {
  const [origin, setOrigin] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (creditsInvoiceId) {
      void getInvoice(creditsInvoiceId).then((result) => {
        if (alive && result.success) setOrigin(`${result.data.invoice.number} od ${formatDate(result.data.invoice.issueDate)}`);
      });
    }
    return () => {
      alive = false;
    };
  }, [creditsInvoiceId]);
  return (
    <p className="text-sm">
      {creditsInvoiceId ? (
        <>
          Poništava račun <strong>{origin ?? '…'}</strong>
        </>
      ) : (
        'Nije povezano s računom — povežite ga u meniju „Za provjeru“.'
      )}
      {reason && <> · razlog: {reason}</>}
    </p>
  );
}
