import { useCallback, useMemo, useState } from 'react';
import { ArrowRightIcon, FilePlusIcon, ListChecksIcon, UsersIcon } from 'lucide-react';
import { toast } from 'sonner';
import { ErrorBlock, LoadingBlock } from '@/components/feedback';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatKM, sum } from '@/features/billing/money';
import { BulkEnrolmentDialog } from '@/features/families/components/BulkEnrolmentDialog';
import { acceptPlanProposals, issueMonthlyInvoices, prepareMonth, type MonthlyPreview } from '@/features/invoices/actions';
import { BALANCE_LABEL, invoiceBalance } from '@/features/invoices/credit-notes';
import { InvoiceDetailDialog } from '@/features/invoices/components/InvoiceDetailDialog';
import { InvoicePdfDialog } from '@/features/invoices/components/InvoicePdfDialog';
import { WithoutEnrolment } from '@/features/invoices/components/IssueMonthDialog';
import { NewInvoiceDialog } from '@/features/invoices/components/NewInvoiceDialog';
import { PreviewInvoiceTable } from '@/features/invoices/components/PreviewInvoiceTable';
import { monthLabel, schoolYearOfMonth } from '@/features/invoices/domain';
import { finalDrafts, previewProblem, previewTotal, type PreviewInvoice } from '@/features/invoices/monthly';
import { amountDue } from '@/features/invoices/pdf';
import { matchesQuery } from '@/features/invoices/search';
import type { PeriodFilter } from '@/features/invoices/pdf-actions';
import type { BillingMonth } from '@/features/invoices/types';
import type { LegalEntityCode } from '@/features/price-lists/types';
import { formatDate } from '@/lib/format';
import { useAsyncResult } from '@/lib/use-async-result';
import { nextMonth, useStepInvoices } from '../style';
import { PrintStep, SendStep, StepNav, type StepDef } from './common';

type Step = 'A' | 'B' | 'C' | 'D' | 'E';
const MONTHLY_KINDS = ['MONTHLY', 'INSTALMENT', 'ENROLMENT_FEES'];
const today = (): string => new Date().toISOString().slice(0, 10);

/**
 * „Fakturisanje“ for one institution (DEFINICIJA-APLIKACIJE §4, specs/guided-flow): the month (default: the next one)
 * and the big steps A. provjeri spisak djece · B. kreiraj fakture · C. štampaj · D. pošalji Office Manageru ·
 * E. prati naplatu. The system computes and proposes; the FAS checks and approves.
 */
export function BillingFlow({ entity, onOpenFamilies }: { entity: LegalEntityCode; onOpenFamilies: () => void }): React.JSX.Element {
  const [month, setMonth] = useState(nextMonth(today()));
  const [step, setStep] = useState<Step>('A');
  const [refresh, setRefresh] = useState(0);
  const [printed, setPrinted] = useState(false);
  const [sent, setSent] = useState(false);
  const load = useCallback(() => prepareMonth(month as BillingMonth, today()), [month, refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  const preview = useAsyncResult(load);
  const filter: PeriodFilter = { from: '', to: '', entity, billingMonth: month, kinds: MONTHLY_KINDS };
  const issued = useStepInvoices(filter, refresh);

  const own = useMemo(() => {
    if (preview.state.status !== 'ready') return null;
    const data = preview.state.data;
    return {
      invoices: data.invoices.filter((i) => i.header.entity === entity),
      planProposals: entity === 'IDSS' ? data.planProposals : [],
      // only this institution's problems and children (Director, 2026-11-21 and 2026-11-22: „hirurški precizno“);
      // a child whose institution is not known (no enrolment, no invoice, e.g. only in the old register) is in no
      // list: it is only counted, and its institution is set in „Dopuna podataka o djeci“
      problems: data.problems.filter((p) => p.entity === null || p.entity === entity),
      withoutEnrolment: data.withoutEnrolment.filter((c) => c.entity === entity),
      unknownInstitution: data.withoutEnrolment.filter((c) => c.entity === null).length,
    };
  }, [preview.state, entity]);

  const issuedCount = issued.invoices?.length ?? 0;
  const openTotal = sum((issued.invoices ?? []).filter((i) => i.kind !== 'CREDIT_NOTE').map((i) => invoiceBalance(i).open));
  const steps: ReadonlyArray<StepDef<Step>> = [
    { id: 'A', label: 'Provjeri spisak djece', done: own !== null && own.problems.length === 0 && own.planProposals.length === 0 },
    { id: 'B', label: 'Kreiraj fakture', done: own !== null && own.invoices.length === 0 && issuedCount > 0 },
    { id: 'C', label: 'Štampaj fakture', done: printed },
    { id: 'D', label: 'Pošalji Office Manageru', done: sent },
    { id: 'E', label: 'Prati naplatu', done: issuedCount > 0 && openTotal === 0 },
  ];
  const reload = () => {
    setRefresh((r) => r + 1);
    preview.reload();
  };

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end gap-4">
        <div className="grid gap-1.5">
          <label htmlFor="flow-month" className="text-sm font-medium">Obračunski mjesec</label>
          <Input id="flow-month" type="month" className="h-10 w-52 text-base" value={month} onChange={(e) => setMonth(e.target.value || nextMonth(today()))} />
        </div>
        <p className="pb-2 text-sm text-muted-foreground">
          Fakture za <strong>{monthLabel(month as BillingMonth)}</strong> · izdato do sada: <strong className="tabular-nums">{issuedCount}</strong>
        </p>
      </div>
      <StepNav entity={entity} steps={steps} active={step} onSelect={setStep} />

      <section className="rounded-lg border p-4">
        {preview.state.status === 'loading' && (step === 'A' || step === 'B') && <LoadingBlock />}
        {preview.state.status === 'error' && (step === 'A' || step === 'B') && <ErrorBlock message={preview.state.error} onRetry={preview.reload} />}
        {step === 'A' && own && (
          <ChildrenStep entity={entity} month={month as BillingMonth} data={own} onChanged={reload} onOpenFamilies={onOpenFamilies} onNext={() => setStep('B')} />
        )}
        {step === 'B' && own && <CreateStep key={`${month}|${refresh}`} entity={entity} month={month as BillingMonth} invoices={own.invoices} onCreated={() => { reload(); setStep('C'); }} />}
        {step === 'C' && (
          <PrintStep
            filter={filter}
            onDone={() => {
              setPrinted(true);
              setStep('D');
            }}
          />
        )}
        {step === 'D' && (
          <SendStep
            filter={filter}
            onDone={() => {
              setSent(true);
              setStep('E');
            }}
          />
        )}
        {step === 'E' && <CollectionStep entity={entity} month={month} onChanged={reload} />}
      </section>
    </div>
  );
}

/** A. Who is billed this month and for how much; what is missing, with the fix next to it. */
function ChildrenStep({
  entity,
  month,
  data,
  onChanged,
  onOpenFamilies,
  onNext,
}: {
  entity: LegalEntityCode;
  month: BillingMonth;
  data: {
    invoices: PreviewInvoice[];
    planProposals: MonthlyPreview['planProposals'];
    problems: MonthlyPreview['problems'];
    withoutEnrolment: MonthlyPreview['withoutEnrolment'];
    unknownInstitution: number;
  };
  onChanged: () => void;
  onOpenFamilies: () => void;
  onNext: () => void;
}): React.JSX.Element {
  const [bulk, setBulk] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={onOpenFamilies}>
          <UsersIcon aria-hidden /> Porodice i djeca (dodaj, ispiši, ispravi)
        </Button>
        <Button variant="outline" onClick={() => setBulk(true)}>
          <ListChecksIcon aria-hidden /> Dopuna podataka o djeci
        </Button>
      </div>

      {data.planProposals.length > 0 && (
        <Alert>
          <AlertTitle>{data.planProposals.length} učenika bez plana plaćanja — sistem predlaže</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-5">
              {data.planProposals.map((p) => (
                <li key={p.plan.enrolmentId}>
                  {p.childName}: {formatKM(p.plan.total)} u {p.plan.instalments} rata po {formatKM(p.plan.items[0]?.amount ?? 0)}
                </li>
              ))}
            </ul>
            <Button
              className="mt-2"
              size="sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                const saved = await acceptPlanProposals(data.planProposals);
                setBusy(false);
                if (!saved.success) return void toast.error(saved.error);
                toast.success(`Sačuvano ${saved.data} planova.`);
                onChanged();
              }}
            >
              Prihvati predložene planove
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {data.problems.length > 0 && (
        <Alert variant="destructive">
          <AlertTitle>Ovo treba ispraviti</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-5">
              {data.problems.map((p, i) => (
                <li key={`${p.familyName}-${i}`}>
                  {p.familyName}: {p.reason}
                </li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      {data.withoutEnrolment.length > 0 && <WithoutEnrolment month={month} children={data.withoutEnrolment} />}
      {data.unknownInstitution > 0 && (
        <p className="text-sm text-muted-foreground">
          Još {data.unknownInstitution} djece nema poznatu ustanovu (npr. samo u registru starog Excela, bez ijedne fakture i upisa), pa nisu ni na spisku IMH ni na spisku IDSS.
          Ako neko od njih treba fakturisati, odredite mu ustanovu i program u „Dopuna podataka o djeci“.
        </p>
      )}

      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="p-2 font-medium">Dijete</th>
            <th className="hidden p-2 font-medium md:table-cell">Kupac</th>
            <th className="p-2 font-medium">Na fakturi</th>
            <th className="p-2 text-right font-medium">Iznos</th>
          </tr>
        </thead>
        <tbody>
          {data.invoices.map((inv) => (
            <tr key={inv.key} className="border-b align-top">
              <td className="p-2 font-medium">{inv.header.childName}</td>
              <td className="hidden p-2 md:table-cell">{inv.header.buyerName}</td>
              <td className="p-2 text-muted-foreground">{inv.lines.map((l) => l.line.description.split(' — ')[0]).join(' · ')}</td>
              <td className="p-2 text-right tabular-nums">{formatKM(previewTotal(inv))}</td>
            </tr>
          ))}
          {data.invoices.length === 0 && (
            <tr>
              <td colSpan={4} className="p-3 text-muted-foreground">
                Za {monthLabel(month)} nema djece {entity} za fakturisanje (ili su fakture već izdate).
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <div>
        <Button size="lg" onClick={onNext}>
          Dalje: B. Kreiraj fakture <ArrowRightIcon aria-hidden />
        </Button>
      </div>
      <BulkEnrolmentDialog open={bulk} onOpenChange={setBulk} schoolYear={schoolYearOfMonth(month)} onSaved={onChanged} entity={entity} />
    </div>
  );
}

/** B. The proposed invoices, ticked; „Kreiraj sve“ issues them in one transaction (bulk) — or one child (pojedinačno). */
function CreateStep({ entity, month, invoices, onCreated }: { entity: LegalEntityCode; month: BillingMonth; invoices: PreviewInvoice[]; onCreated: () => void }): React.JSX.Element {
  const [list, setList] = useState(invoices);
  const [single, setSingle] = useState(false);
  const [busy, setBusy] = useState(false);
  const blocking = list.flatMap((p) => {
    const problem = previewProblem(p);
    return problem ? [`${p.header.childName}: ${problem}`] : [];
  });
  const drafts = finalDrafts(list);
  async function createAll(): Promise<void> {
    setBusy(true);
    try {
      const result = await issueMonthlyInvoices(drafts);
      if (!result.success) return void toast.error(result.error);
      toast.success(`Kreirano ${result.data.length} faktura.`);
      onCreated();
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg" disabled={busy || drafts.length === 0 || blocking.length > 0} onClick={() => void createAll()}>
          <FilePlusIcon aria-hidden /> {busy ? 'Kreiram…' : `Kreiraj sve (${drafts.length}) · ${formatKM(sum(drafts.map((d) => d.total)))}`}
        </Button>
        <Button size="lg" variant="outline" onClick={() => setSingle(true)}>
          Pojedinačno — jedno dijete
        </Button>
      </div>
      {blocking.length > 0 && <p className="text-sm text-destructive">{blocking.join(' · ')}</p>}
      {list.length === 0 && <p className="text-sm text-muted-foreground">Nema prijedloga: sve fakture za {monthLabel(month)} su izdate. Dalje: C. Štampaj.</p>}
      {list.map((invoice) => (
        <PreviewInvoiceTable key={invoice.key} invoice={invoice} onChange={(change) => setList((all) => all.map((p) => (p.key === invoice.key ? change(p) : p)))} />
      ))}
      <NewInvoiceDialog open={single} onOpenChange={setSingle} onCreated={onCreated} defaultEntity={entity} lockEntity />
    </div>
  );
}

/** E. What is open, partly paid and paid; a click opens the invoice to record a payment (partial payments too). */
function CollectionStep({ entity, month, onChanged }: { entity: LegalEntityCode; month: string; onChanged: () => void }): React.JSX.Element {
  const [onlyMonth, setOnlyMonth] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [openId, setOpenId] = useState<string | null>(null);
  const [pdfId, setPdfId] = useState<string | null>(null);
  // search finds ANY invoice of the institution — paid, open or stornoed — so a payment or a storno can be made on it
  // (Director, 2026-11-27: „Kako da ovo pronađem u app?“)
  const [query, setQuery] = useState('');
  const searching = query.trim() !== '';
  const filter: PeriodFilter = onlyMonth && !searching
    ? { from: '', to: '', entity, billingMonth: month }
    : { from: '2000-01-01', to: '2999-12-31', entity };
  const { invoices, error } = useStepInvoices(filter, refresh);
  const rows = (invoices ?? []).filter((i) => i.kind !== 'CREDIT_NOTE');
  const balances = rows.map((i) => ({ invoice: i, balance: invoiceBalance(i) }));
  const shown = searching
    ? balances.filter((b) => matchesQuery(b.invoice, query)).sort((a, b) => b.invoice.issueDate.localeCompare(a.invoice.issueDate))
    : onlyMonth
      ? balances
      : balances.filter((b) => b.balance.open > 0);
  const total = sum(balances.map((b) => b.balance.net));
  const paid = sum(balances.map((b) => Math.min(b.balance.paid, b.balance.net)));
  const open = sum(balances.map((b) => b.balance.open));
  const overdue = sum(balances.filter((b) => b.balance.open > 0 && b.invoice.dueDate < today()).map((b) => b.balance.open));
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="radio" name="collection" checked={onlyMonth} onChange={() => setOnlyMonth(true)} /> Fakture za {monthLabel(month as BillingMonth)}
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="collection" checked={!onlyMonth} onChange={() => setOnlyMonth(false)} /> Sve neplaćene ({entity})
        </label>
        <Input
          aria-label="Traži račun"
          placeholder="Traži račun: broj, dijete, roditelj (npr. 907/26)"
          className="h-9 w-full sm:w-80"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {searching && (
          <span className="text-muted-foreground">
            Pronađeno: <strong>{shown.length}</strong> (svi računi {entity}, plaćeni i neplaćeni)
          </span>
        )}
      </div>
      <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        {[
          ['Fakturisano', total, ''],
          ['Naplaćeno', paid, 'text-emerald-600 dark:text-emerald-400'],
          ['Otvoreno', open, 'text-amber-600 dark:text-amber-400'],
          ['Od toga dospjelo', overdue, 'text-rose-600 dark:text-rose-400'],
        ].map(([label, value, color]) => (
          <div key={label as string} className="rounded-md border p-3">
            <dt className="text-muted-foreground">{label as string}</dt>
            <dd className={`text-lg font-semibold tabular-nums ${color as string}`}>{formatKM(value as number)}</dd>
          </div>
        ))}
      </dl>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b text-left">
            <th className="p-2 font-medium">Broj</th>
            <th className="p-2 font-medium">Dijete</th>
            <th className="hidden p-2 font-medium sm:table-cell">Rok</th>
            <th className="p-2 text-right font-medium">Iznos</th>
            <th className="hidden p-2 text-right font-medium sm:table-cell">Uplaćeno</th>
            <th className="p-2 text-right font-medium">Ostatak</th>
            <th className="p-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {shown.map(({ invoice, balance }) => (
            <tr key={invoice.id} className="cursor-pointer border-b hover:bg-muted/50" onClick={() => setOpenId(invoice.id)}>
              <td className="p-2 font-medium">{invoice.number}</td>
              <td className="p-2">{invoice.childName || invoice.buyerName}</td>
              <td className="hidden p-2 tabular-nums sm:table-cell">{formatDate(invoice.dueDate)}</td>
              <td className="p-2 text-right tabular-nums">{formatKM(amountDue(invoice))}</td>
              <td className="hidden p-2 text-right tabular-nums sm:table-cell">{formatKM(balance.paid)}</td>
              <td className="p-2 text-right font-medium tabular-nums">{formatKM(balance.open)}</td>
              <td className="p-2">
                <Badge className="whitespace-nowrap" variant={balance.status === 'PAID' ? 'default' : 'outline'}>
                  {BALANCE_LABEL[balance.status]}
                </Badge>
              </td>
            </tr>
          ))}
          {shown.length === 0 && invoices !== null && (
            <tr>
              <td colSpan={7} className="p-3 text-muted-foreground">
                Nema faktura za prikaz.
              </td>
            </tr>
          )}
        </tbody>
      </table>
      <p className="text-xs text-muted-foreground">Klik na fakturu otvara uplatu (i djelimičnu), knjižno odobrenje i PDF.</p>
      <InvoiceDetailDialog
        invoiceId={openId}
        onClose={() => setOpenId(null)}
        onChanged={() => {
          setRefresh((r) => r + 1);
          onChanged();
        }}
        onShowPdf={(id) => {
          setOpenId(null);
          setPdfId(id);
        }}
      />
      <InvoicePdfDialog invoiceId={pdfId} onClose={() => setPdfId(null)} />
    </div>
  );
}
