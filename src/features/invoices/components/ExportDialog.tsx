import { useEffect, useState } from 'react';
import { FileArchiveIcon, MailIcon } from 'lucide-react';
import { toast } from 'sonner';
import { FormDialog } from '@/components/form-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { INVOICE_MAILBOX } from '@/constants';
import { formatKM, sum } from '@/features/billing/money';
import type { LegalEntityCode } from '@/features/price-lists/types';
import { Field } from '@/features/settings/components/OperatorForm';
import type { PeriodFilter } from '../pdf-actions';
import type { InvoiceSummary } from '../repository';

// WHY dynamic: pdf-lib, fontkit and the embedded fonts/logos load only when exporting.
const pdfActions = () => import('../pdf-actions');

type EntityFilter = LegalEntityCode | 'ALL';

export interface ExportRequest {
  readonly from: string;
  readonly to: string;
}

/**
 * Export the invoices of a period as one .zip (BR-31), or open an Outlook draft to the invoice mailbox
 * with every PDF and the .zip attached (BR-28, DL-P006). The operator reviews the draft and sends it.
 */
export function ExportDialog({ request, onClose }: { request: ExportRequest | null; onClose: () => void }): React.JSX.Element {
  return (
    <FormDialog
      open={request !== null}
      onOpenChange={(open) => !open && onClose()}
      title="Izvoz i slanje računa"
      description={`Svi računi izdati u odabranom periodu: kao .zip datoteka, ili Outlook nacrt za ${INVOICE_MAILBOX} sa svakim PDF-om i .zip datotekom u prilogu.`}
      wide
    >
      {request && <ExportBody key={`${request.from}-${request.to}`} request={request} />}
    </FormDialog>
  );
}

function ExportBody({ request }: { request: ExportRequest }): React.JSX.Element {
  const [entity, setEntity] = useState<EntityFilter>('ALL');
  const [from, setFrom] = useState(request.from);
  const [to, setTo] = useState(request.to);
  const [invoices, setInvoices] = useState<InvoiceSummary[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const filter: PeriodFilter = { from, to, entity: entity === 'ALL' ? null : entity };

  useEffect(() => {
    let cancelled = false;
    void pdfActions()
      .then((m) => m.invoicesInPeriod({ from, to, entity: entity === 'ALL' ? null : entity }))
      .then((result) => {
        if (cancelled) return;
        if (result.success) {
          setInvoices(result.data);
          setProblem(null);
        } else {
          setInvoices(null);
          setProblem(result.error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [from, to, entity]);

  const onProgress = (done: number, total: number) => setProgress(`Pripremam PDF ${done} od ${total}…`);

  async function exportZip(): Promise<void> {
    setProgress('Pripremam…');
    try {
      const result = await (await pdfActions()).exportPeriodZip(filter, onProgress);
      if (!result.success) toast.error(result.error);
      else if (result.data) toast.success(`Sačuvano: ${result.data}`);
    } finally {
      setProgress(null);
    }
  }

  async function mail(): Promise<void> {
    setProgress('Pripremam…');
    try {
      const result = await (await pdfActions()).openMailDrafts(filter, onProgress);
      if (!result.success) toast.error(result.error);
      else toast.success(result.data > 1 ? `Otvoreno ${result.data} Outlook nacrta (veliki period je podijeljen).` : 'Outlook nacrt je otvoren — pregledajte ga i kliknite Pošalji.');
    } finally {
      setProgress(null);
    }
  }

  const busy = progress !== null;
  const count = invoices?.length ?? 0;
  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end gap-4">
        <Field id="export-entity" label="Ustanova">
          <Select value={entity} onValueChange={(value) => setEntity(value as EntityFilter)}>
            <SelectTrigger id="export-entity" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">IMH i IDSS</SelectItem>
              <SelectItem value="IMH">IMH</SelectItem>
              <SelectItem value="IDSS">IDSS</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field id="export-from" label="Izdati od">
          <Input id="export-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </Field>
        <Field id="export-to" label="do">
          <Input id="export-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </Field>
      </div>

      <p className="text-sm" aria-live="polite">
        {problem ?? (invoices === null ? 'Učitavam…' : `${count} računa, ukupno ${formatKM(sum(invoices.map((i) => i.total)))}.`)}
      </p>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy || count === 0} onClick={() => void exportZip()}>
          <FileArchiveIcon aria-hidden /> Sačuvaj .zip
        </Button>
        <Button disabled={busy || count === 0} onClick={() => void mail()}>
          <MailIcon aria-hidden /> Outlook nacrt za {INVOICE_MAILBOX}
        </Button>
      </div>
      {progress && <p className="text-sm text-muted-foreground">{progress}</p>}
    </div>
  );
}
