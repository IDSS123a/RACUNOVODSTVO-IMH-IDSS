import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatKM, kmToFenings, MoneyError } from '@/features/billing/money';
import { invoiceBalance } from '../credit-notes';
import { listInvoices, moveCredit, type InvoiceSummary } from '../repository';
import { CREDIT_MOVE_TEMPLATES, CREDIT_REFUND_TEMPLATES } from '../text-templates';
import { TemplateText } from './TemplateText';

const today = (): string => new Date().toISOString().slice(0, 10);
const REFUND = 'refund';

/**
 * Credit on an invoice (S3): move it to another open invoice of the SAME family and institution, or record a
 * refund to the parent. Never automatic; the two institutions are never mixed (CONSTITUTION).
 */
export function CreditMovePanel({ invoice, credit, onMoved }: { invoice: InvoiceSummary; credit: number; onMoved: () => void }): React.JSX.Element {
  const [targets, setTargets] = useState<InvoiceSummary[] | null>(null);
  const [target, setTarget] = useState<string>(REFUND);
  const [amountKm, setAmountKm] = useState(formatKM(credit).replace(' KM', ''));
  const [movedOn, setMovedOn] = useState(today());
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    void listInvoices({ entity: invoice.entity, month: null }).then((result) => {
      if (!alive) return;
      if (!result.success) {
        toast.error(result.error);
        setTargets([]);
        return;
      }
      setTargets(
        result.data.filter(
          (i) => i.familyId === invoice.familyId && i.id !== invoice.id && i.kind !== 'CREDIT_NOTE' && i.status === 'ISSUED' && invoiceBalance(i).open > 0,
        ),
      );
    });
    return () => {
      alive = false;
    };
  }, [invoice]);

  async function submit(): Promise<void> {
    let amount: number;
    try {
      amount = kmToFenings(amountKm);
    } catch (error: unknown) {
      if (error instanceof MoneyError) return void toast.error('unesite iznos, npr. 150,00');
      throw error;
    }
    setBusy(true);
    try {
      if (!note) return;
      const result = await moveCredit({ fromInvoiceId: invoice.id, toInvoiceId: target === REFUND ? null : target, amount, movedOn, note });
      if (!result.success) return void toast.error(result.error);
      toast.success(target === REFUND ? 'Povrat roditelju je evidentiran.' : 'Kredit je prebačen.');
      onMoved();
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="grid gap-3 rounded-lg border p-4" aria-label="Kredit">
      <p className="text-sm font-medium">
        Kredit na ovom računu: <span className="tabular-nums">{formatKM(credit)}</span> — prebacite ga na drugi račun iste porodice ({invoice.entity}) ili evidentirajte povrat.
      </p>
      <div className="grid gap-3 md:grid-cols-4">
        <div className="grid gap-1.5 md:col-span-2">
          <Label htmlFor="credit-target">Kamo</Label>
          <select
            id="credit-target"
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={target}
            onChange={(event) => setTarget(event.target.value)}
          >
            <option value={REFUND}>Povrat roditelju</option>
            {(targets ?? []).map((i) => (
              <option key={i.id} value={i.id}>
                Račun {i.number} · {i.childName || i.buyerName} · otvoreno {formatKM(invoiceBalance(i).open)}
              </option>
            ))}
          </select>
          {targets !== null && targets.length === 0 && <p className="text-xs text-muted-foreground">Porodica nema drugih otvorenih računa u {invoice.entity}.</p>}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="credit-amount">Iznos (KM)</Label>
          <Input id="credit-amount" inputMode="decimal" value={amountKm} onChange={(event) => setAmountKm(event.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="credit-date">Datum</Label>
          <Input id="credit-date" type="date" value={movedOn} onChange={(event) => setMovedOn(event.target.value)} />
        </div>
        <div className="md:col-span-4">
          {/* remounted per target: a refund and a move to an invoice have their own template */}
          <TemplateText
            key={target}
            id="credit-note"
            label="Napomena (obavezno)"
            templates={target === REFUND ? CREDIT_REFUND_TEMPLATES : CREDIT_MOVE_TEMPLATES}
            known={{ racun: targets?.find((i) => i.id === target)?.number ?? '' }}
            onChange={setNote}
          />
        </div>
      </div>
      <div>
        <Button variant="outline" disabled={busy || !note} onClick={() => void submit()}>
          {busy ? 'Spremanje…' : target === REFUND ? 'Evidentiraj povrat' : 'Prebaci kredit'}
        </Button>
      </div>
    </section>
  );
}
