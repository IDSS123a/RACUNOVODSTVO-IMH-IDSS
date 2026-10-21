import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { FileSpreadsheetIcon, UploadIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatKM } from '@/features/billing/money';
import { prepareLegacyImport, runLegacyImport, type PreparedImport } from '../actions';
import type { LegacyImportResult } from '../repository';

const SHOWN_WARNINGS = 50;

/**
 * Import from the previous Excel solution (BR-32): choose the newest workbook, review what will be
 * imported, then import in one transaction. Can be repeated with a newer workbook: nothing is duplicated,
 * only invoices newly marked "plaćeno" get their payment.
 */
export function LegacyImportPanel({ onImported }: { onImported?: () => void }): React.JSX.Element {
  const [prepared, setPrepared] = useState<PreparedImport | null>(null);
  const [result, setResult] = useState<LegacyImportResult | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function choose(): Promise<void> {
    let path: string | null;
    try {
      const picked = await open({ multiple: false, directory: false, filters: [{ name: 'Excel', extensions: ['xlsm', 'xlsx'] }] });
      path = typeof picked === 'string' ? picked : null;
    } catch (error: unknown) {
      toast.error(`Dijalog nije otvoren: ${String(error)}`);
      return;
    }
    if (!path) return;
    setBusy('Čitam dokument…');
    setResult(null);
    try {
      const outcome = await prepareLegacyImport(path);
      if (outcome.success) setPrepared(outcome.data);
      else {
        setPrepared(null);
        toast.error(outcome.error);
      }
    } finally {
      setBusy(null);
    }
  }

  async function runImport(): Promise<void> {
    if (!prepared) return;
    setBusy('Uvozim…');
    try {
      const outcome = await runLegacyImport(prepared);
      if (outcome.success) {
        setResult(outcome.data);
        setPrepared(null);
        toast.success(`Uvezeno: ${outcome.data.invoices} računa, ${outcome.data.families} porodica, ${outcome.data.children} djece.`);
        onImported?.();
      } else toast.error(outcome.error);
    } finally {
      setBusy(null);
    }
  }

  const report = prepared?.report;
  const nothingNew = report ? report.invoicesNew + report.familiesNew + report.childrenNew + report.newlyPaid === 0 : true;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="outline" disabled={busy !== null} onClick={() => void choose()}>
          <FileSpreadsheetIcon aria-hidden /> Odaberi Excel dokument…
        </Button>
        {busy && <span className="text-sm text-muted-foreground">{busy}</span>}
      </div>

      {report && (
        <div className="grid gap-3">
          <p className="text-sm">
            Dokument <strong>{report.fileName}</strong>: {report.invoicesNew} novih računa ({report.lines} stavki), {report.familiesNew} novih porodica,{' '}
            {report.childrenNew} novih djece.
            {report.invoicesExisting > 0 && ` Već uvezeno ranije: ${report.invoicesExisting} računa (ne dupliraju se); novo plaćenih: ${report.newlyPaid}.`}
          </p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ustanova</TableHead>
                <TableHead className="text-right">Računi</TableHead>
                <TableHead className="text-right">Knjižna odobrenja</TableHead>
                <TableHead className="text-right">Plaćeni</TableHead>
                <TableHead className="text-right">Ukupno</TableHead>
                <TableHead>Posljednji broj → nova numeracija</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(['IMH', 'IDSS'] as const).map((entity) => {
                const totals = report.byEntity[entity];
                return (
                  <TableRow key={entity}>
                    <TableCell className="font-medium">{entity}</TableCell>
                    <TableCell className="text-right tabular-nums">{totals.invoices}</TableCell>
                    <TableCell className="text-right tabular-nums">{totals.creditNotes}</TableCell>
                    <TableCell className="text-right tabular-nums">{totals.paid}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatKM(totals.total)}</TableCell>
                    <TableCell className="text-sm">
                      {Object.entries(totals.lastNumbers)
                        .map(([year, last]) => `${String(last).padStart(3, '0')}/${year.slice(2)} → ${entity}-${String(last + 1).padStart(3, '0')}/${year.slice(2)}`)
                        .join(' · ') || '—'}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <p className="text-xs text-muted-foreground">
            Brojevi i iznosi se preuzimaju tačno kako su u Excelu. Račun označen „plaćeno“ dobija uplatu u punom iznosu na dan roka plaćanja (stvarni datum nije poznat).
            Djeca se uvoze bez datuma rođenja i označena su „Dopuniti podatke“.
          </p>
          {report.warnings.length > 0 && (
            <Alert>
              <AlertTitle>Upozorenja ({report.warnings.length})</AlertTitle>
              <AlertDescription>
                <ul className="list-disc pl-5">
                  {report.warnings.slice(0, SHOWN_WARNINGS).map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
                {report.warnings.length > SHOWN_WARNINGS && <p>… i još {report.warnings.length - SHOWN_WARNINGS}.</p>}
              </AlertDescription>
            </Alert>
          )}
          <div>
            <Button disabled={busy !== null || nothingNew} onClick={() => void runImport()}>
              <UploadIcon aria-hidden /> {nothingNew ? 'Nema ništa novo za uvoz' : 'Uvezi'}
            </Button>
          </div>
        </div>
      )}

      {result && (
        <Alert>
          <AlertTitle>Uvoz je završen</AlertTitle>
          <AlertDescription>
            {result.invoices} računa, {result.families} porodica, {result.children} djece, {result.payments} uplata. Nova numeracija:{' '}
            {result.nextNumbers.map(([entity, year, next]) => `${entity}-${String(next).padStart(3, '0')}/${String(year).slice(2)}`).join(', ')}.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
