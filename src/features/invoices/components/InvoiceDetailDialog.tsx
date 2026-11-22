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
import { FORMAT, fullNameField, isRealDate } from '@/lib/validation/formats';
import { BALANCE_LABEL, invoiceBalance } from '../credit-notes';
import { getInvoice, recordPayment, reversePayment, type InvoiceDetail, type Payment } from '../repository';
import { CreditMovePanel } from './CreditMovePanel';
import { CreditNotePanel } from './CreditNotePanel';
import { TemplateText } from './TemplateText';
import { PAYMENT_PURPOSE_TEMPLATES, PAYMENT_REFERENCE_TEMPLATES, REVERSAL_REASON_TEMPLATES } from '../text-templates';
import { MONTH_NAME } from '../types';

const PaymentFormSchema = z.object({
  paidOn: z.string().refine((d) => isRealDate(d) && d <= new Date().toISOString().slice(0, 10), 'unesite stvarni datum uplate (ne u budućnosti)'),
  amountKm: z.string().refine((value) => {
    try {
      return kmToFenings(value) > 0;
    } catch (error: unknown) {
      if (error instanceof MoneyError) return false;
      throw error;
    }
  }, 'unesite iznos, npr. 710,00'),
  payerName: fullNameField(),
  // both come from a template (identical syntax); empty = a template field is still missing
  reference: z.string().trim().min(1, 'popunite šablon reference'),
  note: z.string().trim().min(1, 'popunite šablon svrhe uplate'),
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
  readOnly = false,
}: {
  invoiceId: string | null;
  onClose: () => void;
  onChanged: () => void;
  onShowPdf: (invoiceId: string) => void;
  /** Reporting (DEFINICIJA §4, task 3): look only — no payment, no credit note, no reversal. */
  readOnly?: boolean;
}): React.JSX.Element {
  return (
    <FormDialog open={invoiceId !== null} onOpenChange={(open) => !open && onClose()} title={readOnly ? 'Račun (pregled)' : 'Račun'} wide>
      {invoiceId && <InvoiceBody invoiceId={invoiceId} onChanged={onChanged} onShowPdf={onShowPdf} readOnly={readOnly} />}
    </FormDialog>
  );
}

function InvoiceBody({ invoiceId, onChanged, onShowPdf, readOnly }: { invoiceId: string; onChanged: () => void; onShowPdf: (invoiceId: string) => void; readOnly: boolean }): React.JSX.Element {
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
      readOnly={readOnly}
      onShowPdf={() => onShowPdf(invoiceId)}
      onPaid={() => {
        detail.reload();
        onChanged();
      }}
    />
  );
}

function InvoiceContent({ detail, onPaid, onShowPdf, readOnly }: { detail: InvoiceDetail; onPaid: () => void; onShowPdf: () => void; readOnly: boolean }): React.JSX.Element {
  const { invoice, lines, payments, creditNotes } = detail;
  // Effective balance from the backend: reversed payments and moved credit are already accounted for.
  const summary = invoiceBalance(invoice);
  const [showCreditNote, setShowCreditNote] = useState(false);
  const isCreditNote = invoice.kind === 'CREDIT_NOTE';
  const canCredit = !readOnly && !isCreditNote && invoice.status === 'ISSUED' && summary.net > 0;
  const canPay = !readOnly && !isCreditNote && invoice.status === 'ISSUED';
  const form = useForm<PaymentForm>({
    resolver: zodResolver(PaymentFormSchema),
    defaultValues: {
      paidOn: new Date().toISOString().slice(0, 10),
      amountKm: formatKM(summary.open).replace(' KM', ''),
      payerName: invoice.buyerName,
      reference: '',
      note: '',
    },
  });
  const { errors, isSubmitting } = form.formState;
  const setReference = useCallback((text: string | null) => form.setValue('reference', text ?? ''), [form]);
  const setNote = useCallback((text: string | null) => form.setValue('note', text ?? ''), [form]);
  // what the payment templates already know: this invoice and the month it covers
  const periodMonth = Number(invoice.periodFrom.slice(5, 7));
  const periodYear = Number(invoice.periodFrom.slice(0, 4));
  const known = {
    racun: invoice.number,
    mjesec: MONTH_NAME[periodMonth - 1] ?? '',
    godina: String(periodYear),
    skolska: periodMonth >= 9 ? `${periodYear}/${periodYear + 1}` : `${periodYear - 1}/${periodYear}`,
  };

  async function submit(values: PaymentForm): Promise<void> {
    const result = await recordPayment({
      id: crypto.randomUUID(),
      invoiceId: invoice.id,
      paidOn: values.paidOn,
      amount: kmToFenings(values.amountKm),
      payerName: values.payerName,
      reference: values.reference,
      note: values.note,
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
                {line.quantity > 1 && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    ({line.quantity} {line.unit ?? 'srv'} × {formatKM(line.amount / line.quantity)})
                  </span>
                )}
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
      {!isCreditNote && invoice.kind === 'OTHER' && invoice.source === 'APP' && invoice.reason && (
        <p className="text-sm text-muted-foreground">Ručni račun · osnov: {invoice.reason}</p>
      )}

      {showCreditNote && <CreditNotePanel detail={detail} onCancel={() => setShowCreditNote(false)} onIssued={onPaid} />}

      {!isCreditNote && (
        <div className="grid gap-1 text-sm">
          <p>Uplaćeno: <strong className="tabular-nums">{formatKM(summary.paid)}</strong></p>
          <p>Preostalo: <strong className="tabular-nums">{formatKM(summary.open)}</strong></p>
          {summary.credit > 0 && <p>Kredit (višak uplate): <strong className="tabular-nums">{formatKM(summary.credit)}</strong></p>}
          {payments.map((p) => (
            <PaymentRow key={p.id} payment={p} onReversed={onPaid} readOnly={readOnly} />
          ))}
        </div>
      )}

      {!readOnly && !isCreditNote && summary.credit > 0 && <CreditMovePanel invoice={invoice} credit={summary.credit} onMoved={onPaid} />}

      {canPay && (
        <form className="grid gap-4 rounded-lg border p-4 md:grid-cols-4" onSubmit={form.handleSubmit(submit)} noValidate>
          <p className="text-sm font-medium md:col-span-4">Evidentiraj uplatu (uplatiti može bilo ko iz porodice)</p>
          <Field id="pay-date" label="Datum uplate" error={errors.paidOn?.message}>
            <Input id="pay-date" type="date" {...form.register('paidOn')} />
          </Field>
          <Field id="pay-amount" label="Iznos (KM)" error={errors.amountKm?.message}>
            <Input id="pay-amount" inputMode="decimal" {...form.register('amountKm')} aria-invalid={Boolean(errors.amountKm)} />
          </Field>
          <Field id="pay-payer" label="Uplatio/la" hint={FORMAT.fullName} error={errors.payerName?.message}>
            <Input id="pay-payer" {...form.register('payerName')} />
          </Field>
          <div className="grid gap-1 md:col-span-2">
            <TemplateText id="pay-ref" label="Referenca" templates={PAYMENT_REFERENCE_TEMPLATES} onChange={setReference} />
            {errors.reference && <p className="text-xs text-destructive">{errors.reference.message}</p>}
          </div>
          <div className="grid gap-1 md:col-span-2">
            <TemplateText id="pay-note" label="Svrha uplate" templates={PAYMENT_PURPOSE_TEMPLATES} known={known} onChange={setNote} />
            {errors.note && <p className="text-xs text-destructive">{errors.note.message}</p>}
          </div>
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
function PaymentRow({ payment, onReversed, readOnly }: { payment: Payment; onReversed: () => void; readOnly: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function reverse(): Promise<void> {
    setBusy(true);
    try {
      if (!reason) return;
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
      {!readOnly && !payment.reversedOn && !open && (
        <Button variant="link" size="sm" className="h-auto px-2 py-0" onClick={() => setOpen(true)}>
          Storno uplate…
        </Button>
      )}
      {open && (
        <span className="mt-1 flex flex-wrap items-end gap-2 text-foreground">
          <TemplateText id={`rev-${payment.id}`} label="Razlog storna uplate" templates={REVERSAL_REASON_TEMPLATES} onChange={setReason} />
          <Button size="sm" variant="destructive" disabled={busy || !reason} onClick={() => void reverse()}>
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
