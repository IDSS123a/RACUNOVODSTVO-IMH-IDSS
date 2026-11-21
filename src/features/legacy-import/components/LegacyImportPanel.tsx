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
import { FindingsSummary } from './FindingsSummary';


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
            Brojevi i iznosi se preuzimaju tačno kako su u Excelu. Račun označen „plaćeno“ dobija uplatu na dan roka plaćanja (stvarni datum nije poznat): u
            punom iznosu ako su označene sve stavke, inače u iznosu označenih stavki. Djeca se uvoze bez datuma rođenja i označena su „Dopuniti podatke“.
          </p>
          <FindingsSummary findings={report.findings} />
          {report.isolated.length > 0 && (
            <Alert variant="destructive">
              <AlertTitle>Računi koji se NEĆE uvesti ({report.isolated.length})</AlertTitle>
              <AlertDescription>
                <p>
                  Ovi računi nisu spojeni ni prenumerisani. Riješite ih s knjigovođom u Excelu (npr. novi broj, kupac ili datum) i ponovite uvoz. Ukupno:{' '}
                  {formatKM(report.isolated.reduce((total, invoice) => total + invoice.total, 0))}.
                </p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Broj</TableHead>
                      <TableHead>Excel redovi</TableHead>
                      <TableHead>Kupac / dijete</TableHead>
                      <TableHead className="text-right">Iznos</TableHead>
                      <TableHead>Razlog</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.isolated.map((invoice) => (
                      <TableRow key={`${invoice.entity}|${invoice.number}|${invoice.excelRows}`}>
                        <TableCell className="font-medium">
                          {invoice.entity} {invoice.number}
                        </TableCell>
                        <TableCell className="tabular-nums">{invoice.excelRows}</TableCell>
                        <TableCell>
                          {invoice.buyerName}
                          {invoice.childName && ` / ${invoice.childName}`}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">{formatKM(invoice.total)}</TableCell>
                        <TableCell className="text-sm">{invoice.reason}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
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
