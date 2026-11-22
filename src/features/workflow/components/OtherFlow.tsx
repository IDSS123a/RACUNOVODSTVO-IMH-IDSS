import { useCallback, useMemo, useState } from 'react';
import { ArrowRightIcon, FilePlusIcon } from 'lucide-react';
import { toast } from 'sonner';
import { ErrorBlock, LoadingBlock } from '@/components/feedback';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatKM } from '@/features/billing/money';
import { ACTIVE_STATUSES } from '@/features/families/domain';
import { TemplateText } from '@/features/invoices/components/TemplateText';
import { dueDateForMonth, monthBounds } from '@/features/invoices/domain';
import { loadInstitutionFamilies } from '@/features/invoices/actions';
import { UnitInput } from '@/features/invoices/components/UnitInput';
import { buildManualInvoice, rowTotal, serviceKey, type ManualUnit } from '@/features/invoices/manual';
import type { PeriodFilter } from '@/features/invoices/pdf-actions';
import { issueInvoices, listBilledServices, type InvoiceDraftPayload } from '@/features/invoices/repository';
import { fold } from '@/features/invoices/search';
import { BASIS_TEMPLATES, SERVICE_TEMPLATES } from '@/features/invoices/text-templates';
import type { BillingMonth } from '@/features/invoices/types';
import { PROGRAM_ENTITY, type LegalEntityCode } from '@/features/price-lists/types';
import { useAsyncResult } from '@/lib/use-async-result';
import { PrintStep, SendStep, StepNav, type StepDef } from './common';

type Step = 'A' | 'B' | 'C';
const today = (): string => new Date().toISOString().slice(0, 10);

/**
 * „Ostalo fakturisanje“ for one institution (DEFINICIJA §1: everything not in the price list — summer school,
 * section, trip …): A. one service for one or more children (bulk: one invoice per child) · B. štampaj · C. pošalji.
 */
export function OtherFlow({ entity }: { entity: LegalEntityCode }): React.JSX.Element {
  const [step, setStep] = useState<Step>('A');
  const [month, setMonth] = useState(today().slice(0, 7));
  const [created, setCreated] = useState(0);
  const [printed, setPrinted] = useState(false);
  const [sent, setSent] = useState(false);
  const filter: PeriodFilter = { from: '', to: '', entity, billingMonth: month, kinds: ['OTHER'] };
  const steps: ReadonlyArray<StepDef<Step>> = [
    { id: 'A', label: 'Unesi fakturu/e', done: created > 0 },
    { id: 'B', label: 'Štampaj fakture', done: printed },
    { id: 'C', label: 'Pošalji Office Manageru', done: sent },
  ];
  return (
    <div className="grid gap-5">
      <StepNav entity={entity} steps={steps} active={step} onSelect={setStep} />
      <section className="rounded-lg border p-4">
        {step === 'A' && (
          <EntryStep
            entity={entity}
            month={month}
            onMonth={setMonth}
            onCreated={(count) => {
              setCreated((c) => c + count);
              setStep('B');
            }}
          />
        )}
        {step === 'B' && (
          <PrintStep
            filter={filter}
            onDone={() => {
              setPrinted(true);
              setStep('C');
            }}
          />
        )}
        {step === 'C' && <SendStep filter={filter} onDone={() => setSent(true)} />}
      </section>
    </div>
  );
}

function EntryStep({ entity, month, onMonth, onCreated }: { entity: LegalEntityCode; month: string; onMonth: (m: string) => void; onCreated: (count: number) => void }): React.JSX.Element {
  // only this institution's families and children (families/membership.ts)
  const families = useAsyncResult(useCallback(() => loadInstitutionFamilies(entity, today()), [entity]));
  const [description, setDescription] = useState('');
  const [unit, setUnit] = useState<ManualUnit>('srv');
  const [quantity, setQuantity] = useState('1');
  const [price, setPrice] = useState('');
  const [reason, setReason] = useState('');
  const [issueDate, setIssueDate] = useState(today());
  const [query, setQuery] = useState('');
  const [onlyEnrolled, setOnlyEnrolled] = useState(true);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // services already billed this month: the same service is never billed twice to a child (Director, 2026-11-22)
  const loadBilled = useCallback(() => listBilledServices(entity, monthBounds(month as BillingMonth).from), [entity, month]);
  const billed = useAsyncResult(loadBilled);
  const key = serviceKey(description);
  const billedFor = (childId: string): string | null =>
    key && billed.state.status === 'ready' ? (billed.state.data.find((b) => b.childId === childId && serviceKey(b.description) === key)?.invoiceNumber ?? null) : null;

  const children = useMemo(() => {
    if (families.state.status !== 'ready') return [];
    const { families: own, childIds } = families.state.data;
    return own
      .flatMap((detail) =>
        detail.children.filter((child) => childIds.has(child.id)).map((child) => ({
          detail,
          child,
          enrolled: detail.enrolments.some((e) => e.childId === child.id && PROGRAM_ENTITY[e.program] === entity && ACTIVE_STATUSES.has(e.status)),
        })),
      )
      .sort((a, b) => `${a.child.lastName} ${a.child.firstName}`.localeCompare(`${b.child.lastName} ${b.child.firstName}`, 'bs'));
  }, [families.state, entity]);
  const shown = children.filter(
    (c) => (!onlyEnrolled || c.enrolled) && (query.trim() === '' || fold(`${c.child.firstName} ${c.child.lastName} ${c.detail.family.displayName}`).includes(fold(query.trim()))),
  );
  const row = { description, unit, quantity, unitPrice: price };
  const perChild = rowTotal(row).total;

  if (families.state.status === 'loading') return <LoadingBlock />;
  if (families.state.status === 'error') return <ErrorBlock message={families.state.error} onRetry={families.reload} />;

  async function create(): Promise<void> {
    const dueDate = dueDateForMonth(month as BillingMonth, issueDate);
    const drafts: InvoiceDraftPayload[] = [];
    const problems: string[] = [];
    for (const c of children.filter((x) => selected.has(x.child.id))) {
      const number = billedFor(c.child.id);
      if (number) {
        problems.push(`${c.child.firstName} ${c.child.lastName}: „${description}“ je za ovaj mjesec već fakturisano (${number}).`);
        continue;
      }
      const result = buildManualInvoice(c.detail, { entity, childId: c.child.id, month: month as BillingMonth, issueDate, dueDate, reason, rows: [row] });
      if (result.ok) drafts.push({ ...result.draft, id: crypto.randomUUID(), kind: 'OTHER', lines: [...result.draft.lines], planItems: [] });
      else problems.push(...result.errors.map((e) => `${c.child.firstName} ${c.child.lastName}: ${e}`));
    }
    if (selected.size === 0) problems.push('Označite barem jedno dijete.');
    setErrors([...new Set(problems)]);
    if (problems.length > 0) return;
    setBusy(true);
    try {
      const result = await issueInvoices(drafts);
      if (!result.success) return void toast.error(result.error);
      toast.success(`Kreirano ${result.data.length} faktura.`);
      setSelected(new Set());
      billed.reload();
      onCreated(result.data.length);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      <table className="w-full text-sm">
        <tbody>
          <tr className="border-b align-top">
            <th className="w-40 py-2 pr-3 text-left font-medium text-muted-foreground">Usluga</th>
            <td className="py-2">
              <TemplateText id="other-service" label="Naziv usluge" templates={SERVICE_TEMPLATES} onChange={(t) => setDescription(t ?? '')} />
            </td>
          </tr>
          <tr className="border-b">
            <th className="py-2 pr-3 text-left font-medium text-muted-foreground">Cijena po djetetu</th>
            <td className="flex flex-wrap items-center gap-2 py-2">
              <UnitInput id="other-unit" value={unit} onChange={setUnit} />
              <Input aria-label="Količina" inputMode="numeric" className="h-9 w-20" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
              <span>×</span>
              <Input aria-label="Cijena (KM)" inputMode="decimal" placeholder="0,00" className="h-9 w-28" value={price} onChange={(e) => setPrice(e.target.value)} />
              <span className="tabular-nums">= {perChild === null ? '—' : formatKM(perChild)}</span>
            </td>
          </tr>
          <tr className="border-b align-top">
            <th className="py-2 pr-3 text-left font-medium text-muted-foreground">Osnov</th>
            <td className="py-2">
              <TemplateText id="other-basis" label="Osnov" templates={BASIS_TEMPLATES} onChange={(t) => setReason(t ?? '')} />
            </td>
          </tr>
          <tr className="border-b">
            <th className="py-2 pr-3 text-left font-medium text-muted-foreground">Mjesec i datum</th>
            <td className="flex flex-wrap items-center gap-2 py-2">
              <Input aria-label="Mjesec usluge" type="month" className="h-9 w-44" value={month} onChange={(e) => onMonth(e.target.value || today().slice(0, 7))} />
              <Input aria-label="Datum izdavanja" type="date" className="h-9 w-44" value={issueDate} onChange={(e) => setIssueDate(e.target.value || today())} />
            </td>
          </tr>
        </tbody>
      </table>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <Input aria-label="Traži dijete" placeholder="Traži dijete ili porodicu…" className="h-9 w-64" value={query} onChange={(e) => setQuery(e.target.value)} />
        <label className="flex items-center gap-2">
          <input type="checkbox" className="size-4" checked={onlyEnrolled} onChange={(e) => setOnlyEnrolled(e.target.checked)} /> Samo djeca upisana u {entity}
        </label>
        <Button variant="outline" size="sm" onClick={() => setSelected(new Set([...selected, ...shown.filter((c) => !billedFor(c.child.id)).map((c) => c.child.id)]))}>
          Označi sve prikazane ({shown.filter((c) => !billedFor(c.child.id)).length})
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
          Poništi izbor
        </Button>
        <span className="ml-auto font-medium">Označeno: {selected.size}</span>
      </div>
      <div className="max-h-[40vh] overflow-auto rounded-md border">
        <table className="w-full border-collapse text-sm">
          <tbody>
            {shown.map(({ child, detail, enrolled }) => {
              const already = billedFor(child.id);
              return (
              <tr key={child.id} className={`border-b ${already ? 'bg-muted/40' : 'hover:bg-muted/50'}`}>
                <td className="w-8 p-2">
                  <input
                    type="checkbox"
                    className="size-4"
                    aria-label={`Fakturiši ${child.firstName} ${child.lastName}`}
                    disabled={already !== null}
                    checked={already === null && selected.has(child.id)}
                    onChange={(e) => {
                      const next = new Set(selected);
                      if (e.target.checked) next.add(child.id);
                      else next.delete(child.id);
                      setSelected(next);
                    }}
                  />
                </td>
                <td className="p-2 font-medium">
                  {child.firstName} {child.lastName}
                </td>
                <td className="p-2 text-muted-foreground">{detail.family.displayName}</td>
                <td className="p-2 text-muted-foreground">
                  {already ? <span className="font-medium text-destructive">već fakturisano za ovaj mjesec ({already})</span> : enrolled ? `upisan/a u ${entity}` : 'nije upisan/a'}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {errors.length > 0 && (
        <Alert variant="destructive">
          <AlertTitle>Fakture nisu kreirane</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {errors.slice(0, 12).map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg" disabled={busy} onClick={() => void create()}>
          <FilePlusIcon aria-hidden /> {busy ? 'Kreiram…' : `Kreiraj ${selected.size} faktura${perChild !== null && selected.size > 0 ? ` · ukupno ${formatKM(perChild * selected.size)}` : ''}`}
        </Button>
        <span className="text-sm text-muted-foreground">
          Po jedna faktura za svako označeno dijete. Dalje: B. Štampaj <ArrowRightIcon aria-hidden className="inline size-3" />
        </span>
      </div>
    </div>
  );
}
