import { useCallback } from 'react';
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
import { summarisePayments } from '../domain';
import { getInvoice, recordPayment, type InvoiceDetail } from '../repository';
import { PAYMENT_STATUS_LABEL } from '../types';

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

/** Invoice detail: lines, payments, open balance and "record payment" (any family member may pay). */
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
  // key: re-mount the form after a payment so the default amount shows the new open balance
  return (
    <InvoiceContent
      key={detail.state.data.payments.length}
      detail={detail.state.data}
      onShowPdf={() => onShowPdf(invoiceId)}
      onPaid={() => {
        detail.reload();
        onChanged();
      }}
    />
  );
}

function InvoiceContent({ detail, onPaid, onShowPdf }: { detail: InvoiceDetail; onPaid: () => void; onShowPdf: () => void }): React.JSX.Element {
  const { invoice, lines, payments } = detail;
  const summary = summarisePayments(invoice.total, payments.map((p) => p.amount));
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
        <div className="flex items-center gap-2">
          <Badge variant={summary.status === 'PAID' ? 'default' : 'outline'}>{PAYMENT_STATUS_LABEL[summary.status]}</Badge>
          <Button variant="outline" onClick={onShowPdf}>
            <FileTextIcon aria-hidden /> PDF / štampa
          </Button>
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
            <TableCell colSpan={2} className="font-medium">Ukupno za uplatu</TableCell>
            <TableCell className="text-right font-semibold tabular-nums">{formatKM(invoice.total)}</TableCell>
          </TableRow>
        </TableBody>
      </Table>

      <div className="grid gap-1 text-sm">
        <p>Uplaćeno: <strong className="tabular-nums">{formatKM(summary.paid)}</strong></p>
        <p>Preostalo: <strong className="tabular-nums">{formatKM(summary.open)}</strong></p>
        {summary.credit > 0 && <p>Preplata (kredit): <strong className="tabular-nums">{formatKM(summary.credit)}</strong></p>}
        {payments.map((p) => (
          <p key={p.id} className="text-muted-foreground">
            {formatDate(p.paidOn)} · {formatKM(p.amount)} · uplatio/la {p.payerName}{p.reference ? ` · ${p.reference}` : ''}
          </p>
        ))}
      </div>

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
    </div>
  );
}
