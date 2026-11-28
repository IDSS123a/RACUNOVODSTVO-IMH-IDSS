import { useState } from 'react';
import { CheckIcon, FileArchiveIcon, FileTextIcon, MailIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { INVOICE_MAILBOX } from '@/constants';
import { formatKM, sum } from '@/features/billing/money';
import { PrepaymentOffer } from '@/features/invoices/components/PrepaymentOffer';
import { amountToPay } from '@/features/invoices/pdf';
import type { PeriodFilter } from '@/features/invoices/pdf-actions';
import type { InvoiceSummary } from '@/features/invoices/repository';
import { ENTITY_STYLE, useStepInvoices } from '../style';
import type { LegalEntityCode } from '@/features/price-lists/types';

const pdfActions = () => import('@/features/invoices/pdf-actions');

export interface StepDef<Id extends string> {
  readonly id: Id;
  readonly label: string;
  readonly done: boolean;
}

/** Big step labels A, B, C … in the institution's colour; done steps carry ✓ (DEFINICIJA-APLIKACIJE §4). */
export function StepNav<Id extends string>({ entity, steps, active, onSelect }: { entity: LegalEntityCode; steps: ReadonlyArray<StepDef<Id>>; active: Id; onSelect: (id: Id) => void }): React.JSX.Element {
  const style = ENTITY_STYLE[entity];
  return (
    <nav aria-label="Koraci" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
      {steps.map((step) => {
        const isActive = step.id === active;
        return (
          <button
            key={step.id}
            type="button"
            aria-current={isActive ? 'step' : undefined}
            onClick={() => onSelect(step.id)}
            className={`flex items-center gap-3 rounded-lg border-2 p-3 text-left transition-colors ${isActive ? `${style.border} ${style.soft}` : 'border-transparent bg-muted/50 hover:bg-muted'}`}
          >
            <span className={`grid size-10 shrink-0 place-items-center rounded-full text-lg font-bold text-white ${step.done ? 'bg-emerald-600' : style.bg}`}>
              {step.done ? <CheckIcon aria-label="završeno" className="size-5" /> : step.id}
            </span>
            <span className="font-semibold leading-tight">{step.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

function Summary({ invoices, error }: { invoices: InvoiceSummary[] | null; error: string | null }): React.JSX.Element {
  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (invoices === null) return <p className="text-sm text-muted-foreground">Učitavam…</p>;
  return (
    <p className="text-sm">
      <strong className="tabular-nums">{invoices.length}</strong> faktura, ukupno <strong className="tabular-nums">{formatKM(sum(invoices.map(amountToPay)))}</strong>
    </p>
  );
}

/** Step „Štampaj fakture“: every invoice of the filter as PDFs in one .zip (DOCX follows the same path, DL-P019). */
export function PrintStep({ filter, onDone }: { filter: PeriodFilter; onDone: () => void }): React.JSX.Element {
  const [refresh, setRefresh] = useState(0);
  const { invoices, error } = useStepInvoices(filter, refresh);
  const [progress, setProgress] = useState<string | null>(null);
  async function run(format: 'pdf' | 'docx'): Promise<void> {
    setProgress('Pripremam…');
    try {
      const m = await pdfActions();
      const onProgress = (done: number, total: number) => setProgress(`Pripremam ${done} od ${total}…`);
      const result = format === 'pdf' ? await m.exportPeriodZip(filter, onProgress) : await m.exportPeriodDocxZip(filter, onProgress);
      if (!result.success) toast.error(result.error);
      else if (result.data) {
        toast.success(`Sačuvano: ${result.data}`);
        onDone();
      } else toast.info('Spremanje otkazano — dokument nije sačuvan.');
    } finally {
      setProgress(null);
    }
  }
  const empty = !invoices || invoices.length === 0;
  return (
    <div className="grid gap-4">
      <Summary invoices={invoices} error={error} />
      {invoices && invoices.length > 0 && (
        <PrepaymentOffer invoiceIds={invoices.filter((i) => i.kind !== 'CREDIT_NOTE').map((i) => i.id)} onApplied={() => setRefresh((r) => r + 1)} />
      )}
      <div className="flex flex-wrap gap-3">
        <Button size="lg" disabled={progress !== null || empty} onClick={() => void run('pdf')}>
          <FileArchiveIcon aria-hidden /> Sačuvaj sve kao PDF (.zip)
        </Button>
        <Button size="lg" variant="outline" disabled={progress !== null || empty} onClick={() => void run('docx')}>
          <FileTextIcon aria-hidden /> Sačuvaj sve kao DOCX (.zip)
        </Button>
      </div>
      {progress && <p className="text-sm text-muted-foreground">{progress}</p>}
    </div>
  );
}

/** Step „Pošalji Office Manageru“: one Outlook draft with every PDF; the FAS only presses Send (DL-P006). */
export function SendStep({ filter, onDone }: { filter: PeriodFilter; onDone: () => void }): React.JSX.Element {
  const { invoices, error } = useStepInvoices(filter, 0);
  const [progress, setProgress] = useState<string | null>(null);
  async function send(): Promise<void> {
    setProgress('Pripremam…');
    try {
      const result = await (await pdfActions()).openMailDrafts(filter, (done, total) => setProgress(`Pripremam PDF ${done} od ${total}…`));
      if (!result.success) toast.error(result.error);
      else {
        toast.success(result.data > 1 ? `Otvoreno ${result.data} Outlook nacrta (podijeljeno zbog veličine).` : 'Outlook nacrt je otvoren — pregledajte ga i kliknite Pošalji.');
        onDone();
      }
    } finally {
      setProgress(null);
    }
  }
  return (
    <div className="grid gap-4">
      <Summary invoices={invoices} error={error} />
      <p className="text-sm text-muted-foreground">
        Otvara se Outlook nacrt za Office Managera ({INVOICE_MAILBOX}) sa svakom fakturom kao PDF i spiskom u tekstu. Office Manager ih prosljeđuje roditeljima.
      </p>
      <div>
        <Button size="lg" disabled={progress !== null || !invoices || invoices.length === 0} onClick={() => void send()}>
          <MailIcon aria-hidden /> Pripremi e-mail za Office Managera
        </Button>
      </div>
      {progress && <p className="text-sm text-muted-foreground">{progress}</p>}
    </div>
  );
}
