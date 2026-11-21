import { useCallback, useEffect, useState } from 'react';
import { CheckIcon, FileSpreadsheetIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatKM } from '@/features/billing/money';
import { saveStoredFindingsReport } from '../actions';
import { FINDING_CATEGORIES, SEVERITY_LABEL, type FindingCategory } from '../diagnostics';
import { listImportFindings, resolveImportFinding, type ImportFindingRow } from '../repository';

const titleOf = (category: string): string => FINDING_CATEGORIES[category as FindingCategory]?.title ?? category;

/**
 * „Za provjeru“: findings of the legacy import, resolved gradually after go-live (Director, Q4).
 * Each open finding is marked resolved with a note; the change is audited in the backend (BR-30).
 */
export function ReviewFindingsPage({ onChanged }: { onChanged?: () => void }): React.JSX.Element {
  const [rows, setRows] = useState<ImportFindingRow[] | null>(null);
  const [onlyOpen, setOnlyOpen] = useState(true);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    const result = await listImportFindings(onlyOpen);
    if (result.success) setRows(result.data);
    else toast.error(result.error);
  }, [onlyOpen]);

  useEffect(() => {
    void load();
  }, [load]);

  async function resolve(row: ImportFindingRow): Promise<void> {
    setBusy(row.id);
    try {
      const result = await resolveImportFinding(row.id, notes[row.id] ?? '');
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(`Nalaz ${[row.entity, row.number].filter(Boolean).join(' ')} je označen kao riješen.`);
      setNotes((current) => Object.fromEntries(Object.entries(current).filter(([id]) => id !== row.id)));
      await load();
      onChanged?.();
    } finally {
      setBusy(null);
    }
  }

  async function report(): Promise<void> {
    setBusy('report');
    try {
      const result = await saveStoredFindingsReport();
      if (!result.success) toast.error(result.error);
      else if (result.data) toast.success(`Izvještaj je sačuvan: ${result.data}`);
    } finally {
      setBusy(null);
    }
  }

  const open = rows?.filter((r) => !r.resolvedAt && r.severity !== 'INFO').length ?? 0;
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Za provjeru — nalazi uvoza</h1>
          <p className="text-sm text-muted-foreground">
            Nelogičnosti iz starog Excel rješenja. Rješavaju se postepeno; iznosi uvezenih računa se ovdje ne mijenjaju. Neriješenih: {open}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => setOnlyOpen((v) => !v)}>
            {onlyOpen ? 'Prikaži i riješene' : 'Samo neriješeni'}
          </Button>
          <Button variant="outline" disabled={busy !== null} onClick={() => void report()}>
            <FileSpreadsheetIcon aria-hidden /> Sačuvaj izvještaj (Excel)
          </Button>
        </div>
      </div>

      {rows === null && <p className="text-sm text-muted-foreground">Učitavam…</p>}
      {rows !== null && rows.length === 0 && <p className="text-sm">{onlyOpen ? 'Nema neriješenih nalaza.' : 'Nema nalaza uvoza.'}</p>}
      {rows !== null && rows.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Težina</TableHead>
              <TableHead>Kategorija</TableHead>
              <TableHead>Račun</TableHead>
              <TableHead>Kupac / dijete</TableHead>
              <TableHead>Excel redovi</TableHead>
              <TableHead>Razlog</TableHead>
              <TableHead className="text-right">Iznos</TableHead>
              <TableHead>Rješenje</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={row.id}>
                <TableCell>
                  <Badge variant={row.severity === 'ISOLATE' ? 'destructive' : row.severity === 'REVIEW' ? 'default' : 'secondary'}>
                    {SEVERITY_LABEL[row.severity]}
                  </Badge>
                </TableCell>
                <TableCell className="text-sm">{titleOf(row.category)}</TableCell>
                <TableCell className="font-medium">{[row.entity, row.number].filter(Boolean).join(' ') || 'Registar'}</TableCell>
                <TableCell className="text-sm">
                  {row.buyerName}
                  {row.childName && ` / ${row.childName}`}
                </TableCell>
                <TableCell className="text-sm tabular-nums">{row.excelRows}</TableCell>
                <TableCell className="max-w-md text-sm">{row.reason}</TableCell>
                <TableCell className="text-right tabular-nums">{row.amount === null ? '' : formatKM(row.amount)}</TableCell>
                <TableCell className="min-w-64">
                  {row.resolvedAt ? (
                    <span className="text-sm">
                      <CheckIcon aria-hidden className="inline size-4" /> {row.resolvedAt.slice(0, 10)}: {row.resolutionNote}
                    </span>
                  ) : (
                    <div className="flex gap-2">
                      <Input
                        aria-label={`Kako je riješen nalaz ${row.number}`}
                        placeholder="Kako je riješeno…"
                        maxLength={500}
                        value={notes[row.id] ?? ''}
                        onChange={(event) => setNotes((current) => ({ ...current, [row.id]: event.target.value }))}
                      />
                      <Button size="sm" disabled={busy !== null || !(notes[row.id] ?? '').trim()} onClick={() => void resolve(row)}>
                        Riješeno
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}
