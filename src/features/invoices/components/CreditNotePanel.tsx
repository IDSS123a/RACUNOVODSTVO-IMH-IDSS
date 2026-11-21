import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatKM, kmToFenings, MoneyError } from '@/features/billing/money';
import { creditableLines, CreditNoteError, creditNoteLines, creditNoteTotal, type CreditSelection } from '../credit-notes';
import { issueCreditNote, type InvoiceDetail } from '../repository';

const today = (): string => new Date().toISOString().slice(0, 10);

/**
 * „Knjižno odobrenje“ (S1, S2): cancel the whole invoice or chosen amounts per line, with a reason.
 * The original is never changed; the backend numbers the credit note (IMH-KO-…/IDSS-KO-…) and cancels the
 * invoice when nothing is left, so the month can be billed again (S6).
 */
export function CreditNotePanel({ detail, onIssued, onCancel }: { detail: InvoiceDetail; onIssued: () => void; onCancel: () => void }): React.JSX.Element {
  const lines = useMemo(() => creditableLines(detail.lines, detail.creditedLines), [detail]);
  const [mode, setMode] = useState<'WHOLE' | 'LINES'>('WHOLE');
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [reason, setReason] = useState('');
  const [issueDate, setIssueDate] = useState(today());
  const [busy, setBusy] = useState(false);

  const preview = useMemo(() => {
    try {
      const selection: CreditSelection =
        mode === 'WHOLE'
          ? { kind: 'WHOLE' }
          : {
              kind: 'LINES',
              amounts: new Map(
                Object.entries(amounts)
                  .filter(([, text]) => text.trim() !== '')
                  .map(([position, text]) => [Number(position), kmToFenings(text)]),
              ),
            };
      return { lines: creditNoteLines(lines, selection), error: null };
    } catch (error: unknown) {
      if (error instanceof CreditNoteError || error instanceof MoneyError) return { lines: [], error: error instanceof MoneyError ? 'unesite iznos, npr. 150,00' : error.message };
      throw error;
    }
  }, [mode, amounts, lines]);

  async function submit(): Promise<void> {
    if (preview.error || preview.lines.length === 0) return;
    setBusy(true);
    try {
      const result = await issueCreditNote({ id: crypto.randomUUID(), invoiceId: detail.invoice.id, issueDate, reason, lines: preview.lines });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(`Izdato knjižno odobrenje ${result.data.number}${result.data.cancelled ? ` — račun ${detail.invoice.number} je storniran u cijelosti` : ''}.`);
      onIssued();
    } finally {
      setBusy(false);
    }
  }

  const total = creditNoteTotal(preview.lines);
  return (
    <section className="grid gap-4 rounded-lg border border-destructive/40 p-4" aria-label="Knjižno odobrenje">
      <div>
        <p className="font-medium">Knjižno odobrenje (storno) za račun {detail.invoice.number}</p>
        <p className="text-sm text-muted-foreground">Račun ostaje u evidenciji; knjižno odobrenje dobija svoj broj. Uplaćeni novac nikad ne nestaje — višak postaje kredit porodice.</p>
      </div>
      <div className="flex flex-wrap gap-4 text-sm" role="radiogroup" aria-label="Obim">
        <label className="flex items-center gap-2">
          <input type="radio" name="credit-mode" checked={mode === 'WHOLE'} onChange={() => setMode('WHOLE')} /> Cijeli račun (sve što je preostalo)
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" name="credit-mode" checked={mode === 'LINES'} onChange={() => setMode('LINES')} /> Dio računa (iznos po stavci)
        </label>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Stavka</TableHead>
            <TableHead className="text-right">Iznos</TableHead>
            <TableHead className="text-right">Može se odobriti</TableHead>
            {mode === 'LINES' && <TableHead className="w-40 text-right">Odobriti (KM)</TableHead>}
          </TableRow>
        </TableHeader>
        <TableBody>
          {lines.map((line) => (
            <TableRow key={line.position}>
              <TableCell>{line.description}</TableCell>
              <TableCell className="text-right tabular-nums">{formatKM(line.amount)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatKM(line.remaining)}</TableCell>
              {mode === 'LINES' && (
                <TableCell className="text-right">
                  <Input
                    aria-label={`Iznos za odobriti, stavka ${line.position}`}
                    inputMode="decimal"
                    disabled={line.remaining === 0}
                    value={amounts[line.position] ?? ''}
                    onChange={(event) => setAmounts((current) => ({ ...current, [line.position]: event.target.value }))}
                  />
                </TableCell>
              )}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="grid gap-3 md:grid-cols-[1fr_12rem]">
        <div className="grid gap-1.5">
          <Label htmlFor="cn-reason">Razlog (obavezno)</Label>
          <Input id="cn-reason" maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="npr. dijete ispisano od 15.10." />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="cn-date">Datum knjižnog odobrenja</Label>
          <Input id="cn-date" type="date" min={detail.invoice.issueDate} value={issueDate} onChange={(event) => setIssueDate(event.target.value)} />
        </div>
      </div>
      <p className="text-sm" aria-live="polite">
        {preview.error ? <span className="text-destructive">{preview.error}</span> : <>Knjižno odobrenje: <strong className="tabular-nums">{formatKM(total)}</strong></>}
      </p>
      <div className="flex gap-2">
        <Button variant="destructive" disabled={busy || Boolean(preview.error) || !reason.trim()} onClick={() => void submit()}>
          {busy ? 'Izdajem…' : 'Izdaj knjižno odobrenje'}
        </Button>
        <Button variant="outline" disabled={busy} onClick={onCancel}>
          Odustani
        </Button>
      </div>
    </section>
  );
}
