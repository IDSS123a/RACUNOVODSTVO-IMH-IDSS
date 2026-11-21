import { useState } from 'react';
import { PlusIcon } from 'lucide-react';
import { toast } from 'sonner';
import { FormDialog } from '@/components/form-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatKM, sum } from '@/features/billing/money';
import { Field } from '@/features/settings/components/OperatorForm';
import { formatDate } from '@/lib/format';
import { prepareMonth, issueMonthlyInvoices, type MonthlyPreview } from '../actions';
import { monthLabel, schoolYearOfMonth } from '../domain';
import { parsePrice, parseQuantity, type ManualUnit } from '../manual';
import { extraServiceLine, finalDrafts, previewProblem, previewTotal, type PreviewInvoice } from '../monthly';
import type { BillingMonth } from '../types';
import { BASIS_TEMPLATES, SERVICE_TEMPLATES } from '../text-templates';
import { TemplateText } from './TemplateText';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Two-step monthly billing for IMH and IDSS (BR-26), one invoice per child with everything due for it (Director,
 * 2026-11-21): the preview proposes tuition / instalments / breakfast and the one-time items not billed yet; the
 * operator confirms each invoice, decides which lines it shows and may add a service outside the price list with its
 * basis. All confirmed invoices are created in one transaction. Problems are listed, never skipped silently.
 */
export function IssueMonthDialog({
  open,
  onOpenChange,
  onIssued,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called with the issue date, so the caller can offer export / sending of the new invoices. */
  onIssued: (issueDate: string) => void;
}): React.JSX.Element {
  const [month, setMonth] = useState<string>(today().slice(0, 7));
  const [issueDate, setIssueDate] = useState<string>(today());
  const [preview, setPreview] = useState<MonthlyPreview | null>(null);
  const [busy, setBusy] = useState(false);

  async function prepare(): Promise<void> {
    setBusy(true);
    try {
      const result = await prepareMonth(month as BillingMonth, issueDate);
      if (result.success) setPreview(result.data);
      else toast.error(result.error);
    } finally {
      setBusy(false);
    }
  }

  const update = (key: string, change: (p: PreviewInvoice) => PreviewInvoice) =>
    setPreview((current) => (current ? { ...current, invoices: current.invoices.map((p) => (p.key === key ? change(p) : p)) } : current));

  const invoices = preview?.invoices ?? [];
  const blocking = invoices.flatMap((p) => {
    const problem = previewProblem(p);
    return problem ? [`${p.header.childName} (${p.header.entity}): ${problem}`] : [];
  });
  const drafts = finalDrafts(invoices);

  async function issue(): Promise<void> {
    if (drafts.length === 0 || blocking.length > 0) return;
    setBusy(true);
    try {
      const result = await issueMonthlyInvoices(drafts);
      if (result.success) {
        const first = result.data[0];
        const last = result.data[result.data.length - 1];
        toast.success(`Izdato ${result.data.length} računa (${first}${result.data.length > 1 ? ` – ${last}` : ''}).`);
        setPreview(null);
        onIssued(issueDate);
        onOpenChange(false);
      } else toast.error(result.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <FormDialog
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) setPreview(null);
        onOpenChange(isOpen);
      }}
      title="Mjesečni računi — IMH i IDSS"
      description="Jedan račun za svako dijete sa svim što se za njega naplaćuje: školarina (IDSS: rate i doručak) i jednokratni troškovi upisa dok nisu fakturisani. Provjerite svaki račun, isključite stavke koje ne idu ovaj mjesec ili dodajte uslugu van cjenovnika. Računi se kreiraju tek kad odobrite."
      wide
    >
      <div className="grid gap-4">
        <div className="flex flex-wrap items-end gap-4">
          <Field id="issue-month" label="Mjesec">
            <Input id="issue-month" type="month" value={month} onChange={(e) => { setMonth(e.target.value); setPreview(null); }} />
          </Field>
          <Field id="issue-date" label="Datum izdavanja">
            <Input id="issue-date" type="date" value={issueDate} onChange={(e) => { setIssueDate(e.target.value); setPreview(null); }} />
          </Field>
          <Button variant="outline" disabled={busy || !month || !issueDate} onClick={() => void prepare()}>
            {busy && !preview ? 'Pripremam…' : 'Pripremi pregled'}
          </Button>
        </div>

        {preview && (
          <>
            {preview.problems.length > 0 && (
              <Alert variant="destructive">
                <AlertTitle>Nije uključeno — provjerite</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-5">
                    {preview.problems.map((p, index) => (
                      <li key={`${p.familyName}-${index}`}>
                        {p.familyName}: {p.reason}
                      </li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            {preview.withoutEnrolment.length > 0 && <WithoutEnrolment month={month as BillingMonth} children={preview.withoutEnrolment} />}
            {invoices.length === 0 ? (
              <p className="text-sm text-muted-foreground">Za {monthLabel(month as BillingMonth)} nema računa za izdavanje.</p>
            ) : (
              <div className="grid gap-3">
                {invoices.map((invoice) => (
                  <PreviewCard key={invoice.key} invoice={invoice} onChange={(change) => update(invoice.key, change)} />
                ))}
                <p className="text-right font-medium">
                  Ukupno za izdavanje ({drafts.length} računa): <span className="tabular-nums">{formatKM(sum(drafts.map((d) => d.total)))}</span>
                </p>
              </div>
            )}
            {blocking.length > 0 && (
              <Alert variant="destructive">
                <AlertTitle>Prije odobravanja</AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-5">
                    {blocking.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                </AlertDescription>
              </Alert>
            )}
            <div>
              <Button disabled={busy || drafts.length === 0 || blocking.length > 0} onClick={() => void issue()}>
                {busy ? 'Kreiram…' : `Odobri i kreiraj ${drafts.length} računa`}
              </Button>
            </div>
          </>
        )}
      </div>
    </FormDialog>
  );
}

/** Children not billed because they have no enrolment in the school year — never hidden (E-5). */
function WithoutEnrolment({ month, children }: { month: BillingMonth; children: MonthlyPreview['withoutEnrolment'] }): React.JSX.Element {
  const imported = children.filter((c) => c.importReview).length;
  return (
    <Alert>
      <AlertTitle>
        {children.length} {children.length === 1 ? 'dijete nema' : 'djece nema'} upis za školsku godinu {schoolYearOfMonth(month)} — za njih nema računa
      </AlertTitle>
      <AlertDescription>
        <p>
          Račun se predlaže tek kad dijete ima upis (ustanova, program, početak) i datum rođenja. Unesite ih u „Porodice“ → „Upis djece bez upisa“ (sva djeca odjednom) ili u kartici porodice.
          {imported > 0 && ` Od toga ${imported} uvezeno iz Excela: stari Excel nema program ni datum rođenja, pa se to unosi jednom, pri puštanju u rad.`}
        </p>
        <details className="mt-1">
          <summary className="cursor-pointer">Prikaži djecu</summary>
          <ul className="mt-1 max-h-48 list-disc overflow-y-auto pl-5">
            {children.map((c, index) => (
              <li key={`${c.familyName}-${c.childName}-${index}`}>
                {c.childName} <span className="text-muted-foreground">({c.familyName})</span>
              </li>
            ))}
          </ul>
        </details>
      </AlertDescription>
    </Alert>
  );
}

function PreviewCard({ invoice, onChange }: { invoice: PreviewInvoice; onChange: (change: (p: PreviewInvoice) => PreviewInvoice) => void }): React.JSX.Element {
  const [adding, setAdding] = useState(false);
  const hasExtra = invoice.lines.some((l) => l.line.itemCode === 'OTHER');
  const { header } = invoice;
  return (
    <div className={`grid gap-2 rounded-md border p-3 ${invoice.included ? '' : 'opacity-60'}`}>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="checkbox"
          className="size-4"
          aria-label={`Izdaj račun za ${header.childName}`}
          checked={invoice.included}
          onChange={(e) => onChange((p) => ({ ...p, included: e.target.checked }))}
        />
        <Badge className={header.entity === 'IMH' ? 'bg-entity-imh-soft text-entity-imh' : 'bg-entity-idss-soft text-entity-idss'}>{header.entity}</Badge>
        <span className="font-medium">{header.childName}</span>
        <span className="text-sm text-muted-foreground">kupac {header.buyerName} · rok {formatDate(header.dueDate)}</span>
        <span className="ml-auto font-semibold tabular-nums">{formatKM(previewTotal(invoice))}</span>
      </div>
      {invoice.included && (
        <>
          <ul className="grid gap-1 pl-7">
            {invoice.lines.map((l) => (
              <li key={l.key} className="grid gap-0.5">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={l.selected}
                    onChange={(e) => onChange((p) => ({ ...p, lines: p.lines.map((x) => (x.key === l.key ? { ...x, selected: e.target.checked } : x)) }))}
                  />
                  <span className={l.selected ? '' : 'text-muted-foreground line-through'}>{l.line.description}</span>
                  <span className="ml-auto tabular-nums">{formatKM(l.line.amount)}</span>
                  {l.line.itemCode === 'OTHER' && (
                    <Button variant="ghost" size="sm" onClick={() => onChange((p) => ({ ...p, lines: p.lines.filter((x) => x.key !== l.key) }))}>
                      Ukloni
                    </Button>
                  )}
                </label>
                {l.note && <p className="pl-6 text-xs text-amber-700 dark:text-amber-400">{l.note}</p>}
              </li>
            ))}
          </ul>
          {invoice.notes.map((n) => (
            <p key={n} className="pl-7 text-xs text-muted-foreground">
              {n}
            </p>
          ))}
          {hasExtra && (
            <div className="pl-7">
              <TemplateText
                id={`basis-${invoice.key}`}
                label="Osnov za uslugu van cjenovnika"
                templates={BASIS_TEMPLATES}
                onChange={(text) => onChange((p) => ({ ...p, reason: text ?? '' }))}
              />
            </div>
          )}
          <div className="pl-7">
            {adding ? (
              <ExtraServiceForm
                onCancel={() => setAdding(false)}
                onAdd={(input) => {
                  onChange((p) => ({ ...p, lines: [...p.lines, extraServiceLine(p, input)] }));
                  setAdding(false);
                }}
              />
            ) : (
              <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
                <PlusIcon aria-hidden /> Dodaj uslugu van cjenovnika
              </Button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ExtraServiceForm({
  onAdd,
  onCancel,
}: {
  onAdd: (input: { description: string; unit: ManualUnit; quantity: number; unitPrice: number }) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [description, setDescription] = useState('');
  const [unit, setUnit] = useState<ManualUnit>('srv');
  const [quantity, setQuantity] = useState('1');
  const [price, setPrice] = useState('');
  const q = parseQuantity(quantity);
  const p = parsePrice(price);
  const valid = description.trim() !== '' && q !== null && p !== null && q * p > 0;
  return (
    <div className="flex flex-wrap items-end gap-2">
      <TemplateText id="extra-desc" label="Naziv usluge" templates={SERVICE_TEMPLATES} onChange={(text) => setDescription(text ?? '')} />
      <select aria-label="JM" className="h-9 rounded-md border bg-transparent px-2 text-sm" value={unit} onChange={(e) => setUnit(e.target.value as ManualUnit)}>
        <option value="srv">srv</option>
        <option value="kom">kom</option>
      </select>
      <Input aria-label="Količina" inputMode="numeric" className="w-20" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
      <Input aria-label="Cijena (KM)" inputMode="decimal" placeholder="Cijena" className="w-28" value={price} onChange={(e) => setPrice(e.target.value)} />
      <span className="pb-2 text-sm tabular-nums">{q !== null && p !== null ? formatKM(q * p) : '—'}</span>
      <Button size="sm" disabled={!valid} onClick={() => q !== null && p !== null && onAdd({ description, unit, quantity: q, unitPrice: p })}>
        Dodaj
      </Button>
      <Button size="sm" variant="ghost" onClick={onCancel}>
        Odustani
      </Button>
    </div>
  );
}
