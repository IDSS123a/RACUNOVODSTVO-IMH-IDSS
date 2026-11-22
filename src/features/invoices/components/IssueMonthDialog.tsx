import { useState } from 'react';
import { toast } from 'sonner';
import { FormDialog } from '@/components/form-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatKM, sum } from '@/features/billing/money';
import { Field } from '@/features/settings/components/OperatorForm';
import { formatDate } from '@/lib/format';
import { acceptPlanProposals, prepareMonth, issueMonthlyInvoices, type MonthlyPreview } from '../actions';
import { monthLabel, schoolYearOfMonth } from '../domain';
import { finalDrafts, previewProblem, type PreviewInvoice } from '../monthly';
import type { BillingMonth } from '../types';
import { PreviewInvoiceTable } from './PreviewInvoiceTable';

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

  async function acceptPlans(): Promise<void> {
    if (!preview) return;
    setBusy(true);
    try {
      const result = await acceptPlanProposals(preview.planProposals);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(`Sačuvano ${result.data} planova plaćanja.`);
    } finally {
      setBusy(false);
    }
    await prepare();
  }

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
            {preview.planProposals.length > 0 && (
              <Alert>
                <AlertTitle>
                  {preview.planProposals.length} {preview.planProposals.length === 1 ? 'učenik IDSS nema' : 'učenika IDSS nema'} plan plaćanja — sistem predlaže
                </AlertTitle>
                <AlertDescription>
                  <ul className="list-disc pl-5">
                    {preview.planProposals.map((p) => (
                      <li key={p.plan.enrolmentId}>
                        {p.childName} ({p.familyName}): {formatKM(p.plan.total)} u {p.plan.instalments} rata po {formatKM(p.plan.items[0]?.amount ?? 0)}, prva rata{' '}
                        {formatDate(p.plan.items[0]?.dueDate ?? '')}
                      </li>
                    ))}
                  </ul>
                  <Button className="mt-2" size="sm" disabled={busy} onClick={() => void acceptPlans()}>
                    Prihvati predložene planove i osvježi pregled
                  </Button>
                </AlertDescription>
              </Alert>
            )}
            {preview.withoutEnrolment.length > 0 && <WithoutEnrolment month={month as BillingMonth} children={preview.withoutEnrolment} />}
            {invoices.length === 0 ? (
              <p className="text-sm text-muted-foreground">Za {monthLabel(month as BillingMonth)} nema računa za izdavanje.</p>
            ) : (
              <div className="grid gap-3">
                {invoices.map((invoice) => (
                  <PreviewInvoiceTable key={invoice.key} invoice={invoice} onChange={(change) => update(invoice.key, change)} />
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
export function WithoutEnrolment({ month, children }: { month: BillingMonth; children: MonthlyPreview['withoutEnrolment'] }): React.JSX.Element {
  const imported = children.filter((c) => c.importReview).length;
  return (
    <Alert>
      <AlertTitle>
        Za {children.length} {children.length === 1 ? 'dijete' : 'djece'} nedostaju podaci (program i datum rođenja) za školsku {schoolYearOfMonth(month)} — zato nemaju fakturu
      </AlertTitle>
      <AlertDescription>
        <p>
          Sistem izračuna fakturu tek kad zna program djeteta i datum rođenja. Dopunite ih dugmetom „Dopuna podataka o djeci“ (sva djeca odjednom).
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
