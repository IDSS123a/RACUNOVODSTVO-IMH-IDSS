import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { FormDialog } from '@/components/form-dialog';
import { Button } from '@/components/ui/button';
import { formatKM, sum } from '@/features/billing/money';
import type { Result } from '@/lib/tauri/invoke';
import { useAsyncResult } from '@/lib/use-async-result';
import { invoiceBalance } from '../credit-notes';
import { applyPrepaid, listInvoices, listPrepaidSources, type InvoiceSummary } from '../repository';

const today = (): string => new Date().toISOString().slice(0, 10);

interface Offer {
  readonly invoice: InvoiceSummary;
  /** What the child has prepaid in the institution (all sources). */
  readonly prepaid: number;
  /** min(prepaid, open) — never more than is open on the invoice (Q2). */
  readonly amount: number;
}

async function loadOffers(invoiceIds: ReadonlyArray<string>): Promise<Result<Offer[]>> {
  const listed = await listInvoices({ entity: null, month: null });
  if (!listed.success) return listed;
  const wanted = listed.data.filter((i) => invoiceIds.includes(i.id) && i.kind !== 'CREDIT_NOTE' && i.status === 'ISSUED');
  const offers: Offer[] = [];
  for (const invoice of wanted) {
    const open = invoiceBalance(invoice).open;
    if (open <= 0) continue;
    const sources = await listPrepaidSources(invoice.familyId, invoice.entity, invoice.childId || null);
    if (!sources.success) return sources;
    const prepaid = sum(sources.data.filter((s) => s.id !== invoice.id).map((s) => s.remaining));
    if (prepaid > 0) offers.push({ invoice, prepaid, amount: Math.min(prepaid, open) });
  }
  return { success: true, data: offers };
}

/**
 * „Primijeni pretplatu“ (specs/family-advance Q2): the child of an invoice has prepaid money in the institution —
 * the app proposes it, the operator confirms with one click; nothing is applied without that click. Shown in the
 * invoice detail and right after issuing (before the PDF is sent). Renders nothing — and calls `onNothing` —
 * when no invoice has a child with prepaid money.
 */
export function PrepaymentOffer({
  invoiceIds,
  onApplied,
  onNothing,
  onSkip,
  asDialog = false,
}: {
  invoiceIds: ReadonlyArray<string>;
  onApplied: () => void;
  /** Called once when there is nothing to offer (e.g. go straight to the PDF). */
  onNothing?: () => void;
  /** „Ne sada“ — shown only when given. */
  onSkip?: () => void;
  /** Shown in its own dialog — only once there is something to offer (no empty dialog while loading). */
  asDialog?: boolean;
}): React.JSX.Element | null {
  const key = invoiceIds.join('|');
  // eslint-disable-next-line react-hooks/exhaustive-deps -- the ids are compared by value
  const load = useCallback(() => loadOffers(invoiceIds), [key]);
  const offers = useAsyncResult(load);
  const [busy, setBusy] = useState(false);
  const told = useRef(false);
  const empty = offers.state.status === 'ready' && offers.state.data.length === 0;
  useEffect(() => {
    if ((empty || offers.state.status === 'error') && !told.current) {
      told.current = true;
      onNothing?.();
    }
  }, [empty, offers.state.status, onNothing]);
  if (offers.state.status !== 'ready' || offers.state.data.length === 0) return null;
  const list = offers.state.data;

  async function apply(targets: ReadonlyArray<Offer>): Promise<void> {
    setBusy(true);
    try {
      let applied = 0;
      for (const offer of targets) {
        // the sources are read again: an earlier application may have used part of them
        const fresh = await loadOffers([offer.invoice.id]);
        const now = fresh.success ? fresh.data[0] : undefined;
        if (!now) continue;
        const result = await applyPrepaid({
          familyId: now.invoice.familyId,
          entity: now.invoice.entity,
          childId: now.invoice.childId || null,
          invoiceId: now.invoice.id,
          amount: now.amount,
          usedOn: today(),
          note: `Primjena pretplate na račun ${now.invoice.number}`,
          sibling: false,
        });
        if (!result.success) return void toast.error(`${now.invoice.number}: ${result.error}`);
        applied += now.amount;
      }
      toast.success(`Primijenjena pretplata: ${formatKM(applied)}.`);
      onApplied();
      offers.reload();
    } finally {
      setBusy(false);
    }
  }

  const content = (
    <section role="status" className="grid gap-2 rounded-md border border-emerald-600/50 bg-emerald-50 p-3 text-sm dark:bg-emerald-950/30" aria-label="Pretplata djeteta">
      <p className="font-medium">Dijete ima pretplatu — primijeniti je na račun?</p>
      <ul className="grid gap-1">
        {list.map((o) => (
          <li key={o.invoice.id} className="flex flex-wrap items-center gap-2">
            <span>
              {o.invoice.number} · {o.invoice.childName || o.invoice.buyerName} · pretplata {formatKM(o.prepaid)} → primijeniti{' '}
              <strong className="tabular-nums">{formatKM(o.amount)}</strong>
            </span>
            <Button size="sm" variant="outline" disabled={busy} onClick={() => void apply([o])}>
              Primijeni {formatKM(o.amount)}
            </Button>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap gap-2">
        {list.length > 1 && (
          <Button size="sm" disabled={busy} onClick={() => void apply(list)}>
            Primijeni na sve ({list.length})
          </Button>
        )}
        {onSkip && (
          <Button size="sm" variant="ghost" disabled={busy} onClick={onSkip}>
            Ne sada
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">Bez vaše potvrde ništa se ne primjenjuje. Na PDF-u računa tada piše „Umanjeno za primljenu pretplatu“.</p>
    </section>
  );
  if (!asDialog) return content;
  return (
    <FormDialog open onOpenChange={(open) => !open && (onSkip ?? onApplied)()} title="Pretplata djeteta">
      {content}
    </FormDialog>
  );
}
