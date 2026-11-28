import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatKM, kmToFenings, MoneyError } from '@/features/billing/money';
import type { LegalEntityCode } from '@/features/price-lists/types';
import { formatDate } from '@/lib/format';
import { useAsyncResult } from '@/lib/use-async-result';
import { invoiceBalance } from '../credit-notes';
import { applyPrepaid, listInvoicePrepaymentUses, listInvoices, reversePrepaymentUse } from '../repository';
import { CREDIT_REFUND_TEMPLATES, REVERSAL_REASON_TEMPLATES } from '../text-templates';
import { TemplateText } from './TemplateText';

const today = (): string => new Date().toISOString().slice(0, 10);

/** „Storno …“ with a reason (S4): a counter-entry, nothing is deleted. */
export function ReverseControl({ label, onReverse }: { label: string; onReverse: (reason: string) => Promise<boolean> }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!open)
    return (
      <Button variant="link" size="sm" className="h-auto p-0" onClick={() => setOpen(true)}>
        {label}
      </Button>
    );
  return (
    <div className="grid gap-2 rounded-md border p-2">
      <TemplateText id={`rev-${label}`} label="Razlog storna" templates={REVERSAL_REASON_TEMPLATES} onChange={setReason} />
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="destructive"
          disabled={busy || !reason}
          onClick={() => {
            if (!reason) return;
            setBusy(true);
            void onReverse(reason).then((ok) => {
              setBusy(false);
              if (ok) setOpen(false);
            });
          }}
        >
          Storniraj
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
          Odustani
        </Button>
      </div>
    </div>
  );
}

interface ChildRef {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
}

/**
 * A child's prepaid money on the family card (specs/family-advance §3): apply it to an open invoice of the child —
 * or, as an explicit transfer with a note, of a brother or sister (Q1) — or refund it. Same family and institution
 * only; the backend refuses everything else.
 */
export function ChildPrepaidActions({
  familyId,
  entity,
  childId,
  prepaid,
  childList,
  onDone,
}: {
  familyId: string;
  entity: LegalEntityCode;
  childId: string | null;
  prepaid: number;
  childList: ReadonlyArray<ChildRef>;
  onDone: () => void;
}): React.JSX.Element {
  const [mode, setMode] = useState<'none' | 'apply' | 'refund'>('none');
  const loadInvoices = useCallback(() => listInvoices({ entity, month: null }), [entity]);
  const invoices = useAsyncResult(loadInvoices);
  const targets =
    invoices.state.status === 'ready'
      ? invoices.state.data.filter((i) => i.familyId === familyId && i.kind !== 'CREDIT_NOTE' && i.status === 'ISSUED' && invoiceBalance(i).open > 0)
      : [];
  const [target, setTarget] = useState('');
  const [amountKm, setAmountKm] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [transferNote, setTransferNote] = useState('');
  const [busy, setBusy] = useState(false);
  const chosen = targets.find((t) => t.id === target);
  const sibling = Boolean(chosen && childId !== null && chosen.childId !== childId);
  const childName = (id: string): string => {
    const c = childList.find((x) => x.id === id);
    return c ? `${c.firstName} ${c.lastName}` : '';
  };

  function amount(): number | null {
    try {
      const value = kmToFenings(amountKm);
      return value > 0 ? value : null;
    } catch (error: unknown) {
      if (error instanceof MoneyError) return null;
      throw error;
    }
  }

  async function submit(): Promise<void> {
    const value = amount();
    if (value === null) return void toast.error('Unesite iznos, npr. 150,00.');
    const text = mode === 'refund' ? note : sibling ? transferNote.trim() : `Primjena pretplate na račun ${chosen?.number ?? ''}`;
    if (!text) return void toast.error(sibling ? 'Za prenos na brata ili sestru upišite napomenu.' : 'Popunite napomenu.');
    if (mode === 'apply' && !chosen) return void toast.error('Izaberite račun.');
    setBusy(true);
    try {
      const result = await applyPrepaid({
        familyId,
        entity,
        childId,
        invoiceId: mode === 'refund' ? null : (chosen?.id ?? null),
        amount: value,
        usedOn: today(),
        note: text,
        sibling,
      });
      if (!result.success) return void toast.error(result.error);
      toast.success(mode === 'refund' ? `Povrat ${formatKM(value)} je evidentiran.` : `Pretplata ${formatKM(value)} je primijenjena na ${chosen?.number ?? ''}.`);
      setMode('none');
      onDone();
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'none')
    return (
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={() => { setMode('apply'); setAmountKm(''); }}>
          Primijeni na račun…
        </Button>
        <Button size="sm" variant="outline" onClick={() => { setMode('refund'); setAmountKm(formatKM(prepaid).replace(' KM', '')); }}>
          Povrat…
        </Button>
      </div>
    );
  return (
    <div className="grid gap-2 rounded-md border p-3">
      {mode === 'apply' && (
        <>
          <label className="grid gap-1">
            <span className="text-xs text-muted-foreground">Račun (otvoreni računi porodice u {entity})</span>
            <select
              className="h-9 rounded-md border bg-transparent px-2 text-sm"
              value={target}
              onChange={(e) => {
                setTarget(e.target.value);
                const t = targets.find((x) => x.id === e.target.value);
                if (t) setAmountKm(formatKM(Math.min(prepaid, invoiceBalance(t).open)).replace(' KM', ''));
              }}
            >
              <option value="">— izaberite račun —</option>
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.number} · {t.childName || t.buyerName} · otvoreno {formatKM(invoiceBalance(t).open)}
                  {childId !== null && t.childId !== childId ? ' · BRAT/SESTRA' : ''}
                </option>
              ))}
            </select>
          </label>
          {targets.length === 0 && <p className="text-sm text-muted-foreground">Porodica nema otvoren račun u {entity}.</p>}
          {sibling && chosen && (
            <label className="grid gap-1">
              <span className="text-xs font-medium text-amber-700 dark:text-amber-400">
                Prenos pretplate na račun brata ili sestre ({childName(chosen.childId)}) — upišite napomenu (obavezno)
              </span>
              <Input value={transferNote} onChange={(e) => setTransferNote(e.target.value)} placeholder="npr. dogovor s roditeljem od 28.11.2026." />
            </label>
          )}
        </>
      )}
      {mode === 'refund' && <TemplateText id={`refund-${childId ?? 'none'}-${entity}`} label="Napomena o povratu" templates={CREDIT_REFUND_TEMPLATES} onChange={setNote} />}
      <label className="grid gap-1">
        <span className="text-xs text-muted-foreground">Iznos (KM), najviše {formatKM(prepaid)}</span>
        <Input inputMode="decimal" className="w-40" value={amountKm} onChange={(e) => setAmountKm(e.target.value)} />
      </label>
      <div className="flex gap-2">
        <Button size="sm" disabled={busy} onClick={() => void submit()}>
          {busy ? 'Spremanje…' : mode === 'refund' ? 'Evidentiraj povrat' : sibling ? 'Prenesi i primijeni' : 'Primijeni'}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => setMode('none')}>
          Odustani
        </Button>
      </div>
    </div>
  );
}

/** Prepaid money on an invoice: used on it („plaćeno iz pretplate“) or taken from its excess — each can be reversed. */
export function InvoicePrepaymentUses({ invoiceId, readOnly, onChanged }: { invoiceId: string; readOnly: boolean; onChanged: () => void }): React.JSX.Element | null {
  const load = useCallback(() => listInvoicePrepaymentUses(invoiceId), [invoiceId]);
  const uses = useAsyncResult(load);
  if (uses.state.status !== 'ready' || uses.state.data.length === 0) return null;
  return (
    <div className="grid gap-1 text-sm text-muted-foreground">
      {uses.state.data.map((u) => (
        <div key={u.id}>
          <span className={u.reversedOn ? 'line-through' : undefined}>
            {formatDate(u.usedOn)} ·{' '}
            {u.amount > 0
              ? `plaćeno iz pretplate ${formatKM(u.amount)}`
              : u.invoiceId
                ? `višak ${formatKM(-u.amount)} primijenjen na ${u.invoiceNumber ?? ''}`
                : `višak ${formatKM(-u.amount)} vraćen`}{' '}
            · {u.note}
          </span>
          {u.reversedOn && ` · stornirano ${formatDate(u.reversedOn)}: ${u.reversalReason ?? ''}`}
          {!readOnly && !u.reversedOn && (
            <>
              {' '}
              <ReverseControl
                label="Storno"
                onReverse={async (reason) => {
                  const result = await reversePrepaymentUse(u.id, today(), reason);
                  if (!result.success) {
                    toast.error(result.error);
                    return false;
                  }
                  toast.success('Stornirano protuknjiženjem.');
                  uses.reload();
                  onChanged();
                  return true;
                }}
              />
            </>
          )}
        </div>
      ))}
    </div>
  );
}

/** „Potvrda o uplati“ (Q5): made only on request, saved where the operator chooses. */
export function ReceiptButton({ request }: { request: Parameters<typeof import('../pdf-actions').buildPaymentReceipt>[0] }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  async function make(): Promise<void> {
    setBusy(true);
    try {
      const actions = await import('../pdf-actions');
      const receipt = await actions.buildPaymentReceipt(request);
      if (!receipt.success) return void toast.error(receipt.error);
      const saved = await actions.saveDocument(receipt.data.bytes, receipt.data.fileName, 'Potvrda o uplati');
      if (!saved.success) toast.error(saved.error);
      else if (saved.data) toast.success(`Sačuvano: ${saved.data}`);
      else toast.info('Spremanje otkazano — dokument nije sačuvan.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <Button variant="link" size="sm" className="h-auto p-0" disabled={busy} onClick={() => void make()}>
      {busy ? 'Pripremam…' : 'Potvrda o uplati'}
    </Button>
  );
}
