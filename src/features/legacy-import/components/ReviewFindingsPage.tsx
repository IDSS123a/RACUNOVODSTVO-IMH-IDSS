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
import { invoiceBalance } from '@/features/invoices/credit-notes';
import { getInvoice, linkLegacyCreditNote, listInvoices, type InvoiceSummary } from '@/features/invoices/repository';

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
                  ) : row.category === 'CREDIT_NOTE_UNLINKED' && row.invoiceId ? (
                    <LinkCreditNote
                      creditNoteId={row.invoiceId}
                      onLinked={() => {
                        void load();
                        onChanged?.();
                      }}
                    />
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

/**
 * „Poveži s računom“ (storno S5): link a credit note imported from the old workbook to the invoice it cancels.
 * Candidates: issued invoices of the same family and institution with enough left to absorb the credit note.
 * Linking resolves the finding in the backend, in the same transaction.
 */
function LinkCreditNote({ creditNoteId, onLinked }: { creditNoteId: string; onLinked: () => void }): React.JSX.Element {
  const [candidates, setCandidates] = useState<InvoiceSummary[] | null>(null);
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const cn = await getInvoice(creditNoteId);
      if (!cn.success) return void (alive && toast.error(cn.error));
      const all = await listInvoices({ entity: cn.data.invoice.entity, month: null });
      if (!all.success) return void (alive && toast.error(all.error));
      const needed = -cn.data.invoice.total;
      if (alive) {
        setCandidates(
          all.data.filter(
            (i) => i.familyId === cn.data.invoice.familyId && i.kind !== 'CREDIT_NOTE' && i.status === 'ISSUED' && invoiceBalance(i).net >= needed,
          ),
        );
      }
    })();
    return () => {
      alive = false;
    };
  }, [creditNoteId]);

  async function link(): Promise<void> {
    setBusy(true);
    try {
      const result = await linkLegacyCreditNote(creditNoteId, target);
      if (!result.success) return void toast.error(result.error);
      toast.success('Knjižno odobrenje je povezano s računom; nalaz je riješen.');
      onLinked();
    } finally {
      setBusy(false);
    }
  }

  if (candidates === null) return <span className="text-sm text-muted-foreground">Tražim račune porodice…</span>;
  if (candidates.length === 0) return <span className="text-sm">Porodica nema računa ove ustanove na koji se ovo knjižno odobrenje može povezati.</span>;
  return (
    <div className="flex gap-2">
      <select
        aria-label="Račun koji knjižno odobrenje poništava"
        className="h-9 min-w-48 rounded-md border bg-background px-2 text-sm"
        value={target}
        onChange={(event) => setTarget(event.target.value)}
      >
        <option value="">Odaberite račun…</option>
        {candidates.map((i) => (
          <option key={i.id} value={i.id}>
            {i.number} · {formatKM(invoiceBalance(i).net)}
          </option>
        ))}
      </select>
      <Button size="sm" disabled={busy || !target} onClick={() => void link()}>
        Poveži s računom
      </Button>
    </div>
  );
}
