import { useState } from 'react';
import { toast } from 'sonner';
import { FormDialog } from '@/components/form-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatKM, sum } from '@/features/billing/money';
import { Field } from '@/features/settings/components/OperatorForm';
import { Badge } from '@/components/ui/badge';
import { prepareMonth, issueMonthlyInvoices, type MonthlyPreview } from '../actions';
import { monthLabel } from '../domain';
import type { BillingMonth } from '../types';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Two-step monthly billing for IMH and IDSS (BR-26): preview every invoice (IMH from the price list,
 * IDSS from the payment plans), then create all of them in one transaction after approval. Problems are listed, never skipped silently.
 */
export function IssueMonthDialog({ open, onOpenChange, onIssued }: { open: boolean; onOpenChange: (open: boolean) => void; onIssued: () => void }): React.JSX.Element {
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

  async function issue(): Promise<void> {
    if (!preview || preview.drafts.length === 0) return;
    setBusy(true);
    try {
      const result = await issueMonthlyInvoices(preview.drafts);
      if (result.success) {
        const first = result.data[0];
        const last = result.data[result.data.length - 1];
        toast.success(`Izdato ${result.data.length} računa (${first}${result.data.length > 1 ? ` – ${last}` : ''}).`);
        setPreview(null);
        onIssued();
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
      description="Zaseban račun za svako dijete: IMH po cjenovniku, IDSS po planu plaćanja (rate s rokom u tom mjesecu). Računi se kreiraju tek kad odobrite pregled."
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
            {preview.drafts.length === 0 ? (
              <p className="text-sm text-muted-foreground">Za {monthLabel(month as BillingMonth)} nema računa za izdavanje.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ustanova</TableHead>
                    <TableHead>Dijete</TableHead>
                    <TableHead>Kupac</TableHead>
                    <TableHead>Stavke</TableHead>
                    <TableHead>Rok</TableHead>
                    <TableHead className="text-right">Iznos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.drafts.map((draft) => (
                    <TableRow key={draft.id}>
                      <TableCell>
                        <Badge className={draft.entity === 'IMH' ? 'bg-entity-imh-soft text-entity-imh' : 'bg-entity-idss-soft text-entity-idss'}>{draft.entity}</Badge>
                      </TableCell>
                      <TableCell className="font-medium">{draft.childName}</TableCell>
                      <TableCell>{draft.buyerName}</TableCell>
                      <TableCell className="text-sm">{draft.lines.map((l) => l.description).join(' · ')}</TableCell>
                      <TableCell>{draft.dueDate}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatKM(draft.total)}</TableCell>
                    </TableRow>
                  ))}
                  <TableRow>
                    <TableCell colSpan={5} className="font-medium">Ukupno ({preview.drafts.length} računa)</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums">{formatKM(sum(preview.drafts.map((d) => d.total)))}</TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            )}
            <div>
              <Button disabled={busy || preview.drafts.length === 0} onClick={() => void issue()}>
                {busy ? 'Kreiram…' : `Odobri i kreiraj ${preview.drafts.length} računa`}
              </Button>
            </div>
          </>
        )}
      </div>
    </FormDialog>
  );
}
