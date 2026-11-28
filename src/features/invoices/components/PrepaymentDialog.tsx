import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { FormDialog } from '@/components/form-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatKM, kmToFenings, MAX_AMOUNT, MoneyError } from '@/features/billing/money';
import type { LegalEntityCode } from '@/features/price-lists/types';
import { Field } from '@/features/settings/components/OperatorForm';
import { useAsyncResult } from '@/lib/use-async-result';
import { isRealDate, normalizeFullName } from '@/lib/validation/formats';
import { invoiceBalance, prepaymentWarnings } from '../credit-notes';
import { listInvoices, recordPrepayment, type PrepaymentRow } from '../repository';
import { PAYMENT_REFERENCE_TEMPLATES, PREPAYMENT_PURPOSE_TEMPLATES } from '../text-templates';
import { PayerRelationInput } from './PayerRelationInput';
import { TemplateText } from './TemplateText';

interface ChildRef {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
}

const today = (): string => new Date().toISOString().slice(0, 10);

function amountOf(text: string): number {
  try {
    return kmToFenings(text);
  } catch (error: unknown) {
    if (error instanceof MoneyError) return 0;
    throw error;
  }
}

/**
 * „Uplata bez računa (pretplata)“ (specs/family-advance §2, BR-24 amended): money received for one child in one
 * institution before any invoice. The child is required (Q1); the payer is typed with the relation to the child
 * (Q6). Warnings: an unpaid invoice of the child (the money is probably for it), the same payment again.
 */
export function PrepaymentDialog({
  familyId,
  childList,
  guardians,
  prepayments,
  open,
  onClose,
  onSaved,
}: {
  familyId: string;
  childList: ReadonlyArray<ChildRef>;
  guardians: ReadonlyArray<{ readonly fullName: string }>;
  prepayments: ReadonlyArray<PrepaymentRow>;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}): React.JSX.Element {
  return (
    <FormDialog open={open} onOpenChange={(o) => !o && onClose()} title="Uplata bez računa (pretplata)" description="Novac primljen prije nego što je izdat račun. Saldo djeteta postaje negativan (u pretplati).">
      {open && <PrepaymentForm familyId={familyId} childList={childList} guardians={guardians} prepayments={prepayments} onClose={onClose} onSaved={onSaved} />}
    </FormDialog>
  );
}

function PrepaymentForm({
  familyId,
  childList,
  guardians,
  prepayments,
  onClose,
  onSaved,
}: {
  familyId: string;
  childList: ReadonlyArray<ChildRef>;
  guardians: ReadonlyArray<{ readonly fullName: string }>;
  prepayments: ReadonlyArray<PrepaymentRow>;
  onClose: () => void;
  onSaved: () => void;
}): React.JSX.Element {
  const [entity, setEntity] = useState<LegalEntityCode>('IMH');
  const [childId, setChildId] = useState(childList.length === 1 ? (childList[0]?.id ?? '') : '');
  const [paidOn, setPaidOn] = useState(today());
  const [amountKm, setAmountKm] = useState('');
  const [payerName, setPayerName] = useState(guardians[0]?.fullName ?? '');
  const [relation, setRelation] = useState('roditelj / staratelj');
  const [reference, setReference] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const loadInvoices = useCallback(() => listInvoices({ entity: null, month: null }), []);
  const invoices = useAsyncResult(loadInvoices);

  const amount = amountOf(amountKm);
  const payer = normalizeFullName(payerName);
  const openInvoices =
    invoices.state.status === 'ready'
      ? invoices.state.data
          .filter((i) => i.familyId === familyId && i.childId === childId && i.entity === entity && i.kind !== 'CREDIT_NOTE' && i.status === 'ISSUED')
          .map((i) => ({ number: i.number, open: invoiceBalance(i).open }))
          .filter((i) => i.open > 0)
      : [];
  const warnings = childId ? prepaymentWarnings(amount, paidOn, openInvoices, prepayments.filter((p) => p.childId === childId && p.entity === entity)) : [];
  const warningKey = warnings.join('|');
  useEffect(() => setConfirmed(false), [warningKey]);

  const problems = [
    ...(childId ? [] : ['Izaberite dijete za koje je uplata.']),
    ...(isRealDate(paidOn) && paidOn <= today() ? [] : ['Unesite stvarni datum uplate (ne u budućnosti).']),
    ...(amount > 0 && amount <= MAX_AMOUNT ? [] : [`Unesite iznos od 0,01 do ${formatKM(MAX_AMOUNT)}, npr. 710,00.`]),
    ...(payer ? [] : ['Unesite ime i prezime uplatioca (slova, bez brojeva).']),
    ...(relation.trim() ? [] : ['Izaberite ili upišite odnos uplatioca prema djetetu.']),
    ...(reference ? [] : ['Popunite šablon reference.']),
    ...(note ? [] : ['Popunite šablon svrhe uplate.']),
  ];

  async function save(): Promise<void> {
    if (problems.length > 0 || !payer || !reference || !note) return;
    setBusy(true);
    try {
      const result = await recordPrepayment({
        id: crypto.randomUUID(),
        familyId,
        entity,
        childId,
        paidOn,
        amount,
        payerName: payer,
        payerRelation: relation.trim(),
        reference,
        note,
      });
      if (!result.success) return void toast.error(result.error);
      toast.success(`Uplata bez računa od ${formatKM(amount)} je evidentirana — dijete je u pretplati.`);
      onSaved();
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4 md:grid-cols-2">
      <Field id="pre-entity" label="Ustanova">
        <select id="pre-entity" className="h-9 rounded-md border bg-transparent px-2 text-sm" value={entity} onChange={(e) => setEntity(e.target.value as LegalEntityCode)}>
          <option value="IMH">IMH</option>
          <option value="IDSS">IDSS</option>
        </select>
      </Field>
      <Field id="pre-child" label="Za dijete">
        <select id="pre-child" className="h-9 rounded-md border bg-transparent px-2 text-sm" value={childId} onChange={(e) => setChildId(e.target.value)}>
          {childList.length !== 1 && <option value="">— izaberite dijete —</option>}
          {childList.map((c) => (
            <option key={c.id} value={c.id}>
              {c.firstName} {c.lastName}
            </option>
          ))}
        </select>
      </Field>
      <Field id="pre-date" label="Datum uplate">
        <Input id="pre-date" type="date" max={today()} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
      </Field>
      <Field id="pre-amount" label="Iznos (KM)">
        <Input id="pre-amount" inputMode="decimal" placeholder="npr. 1.000,00" value={amountKm} onChange={(e) => setAmountKm(e.target.value)} />
      </Field>
      <Field id="pre-payer" label="Uplatio/la (ime s izvoda)" corrected={payer && payer !== payerName.trim() ? payer : undefined}>
        <Input id="pre-payer" list="pre-payer-list" value={payerName} onChange={(e) => setPayerName(e.target.value)} />
        <datalist id="pre-payer-list">
          {guardians.map((g) => (
            <option key={g.fullName} value={g.fullName} />
          ))}
        </datalist>
      </Field>
      <Field id="pre-relation" label="Odnos prema djetetu">
        <PayerRelationInput id="pre-relation" value={relation} onChange={setRelation} invalid={!relation.trim()} />
      </Field>
      <div className="md:col-span-2">
        <TemplateText id="pre-ref" label="Referenca" templates={PAYMENT_REFERENCE_TEMPLATES} onChange={setReference} />
      </div>
      <div className="md:col-span-2">
        <TemplateText id="pre-note" label="Svrha uplate" templates={PREPAYMENT_PURPOSE_TEMPLATES} onChange={setNote} />
      </div>
      {problems.length > 0 && (
        <ul className="grid gap-1 text-sm text-destructive md:col-span-2">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {warnings.length > 0 && (
        <div role="alert" className="grid gap-2 rounded-md border border-amber-500/60 bg-amber-50 p-3 text-sm md:col-span-2 dark:bg-amber-950/30">
          {warnings.map((w) => (
            <p key={w}>{w}</p>
          ))}
          <label className="flex items-center gap-2 font-medium">
            <input type="checkbox" className="size-4" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
            Provjerio/la sam — ovo je uplata bez računa (pretplata) i nije već unesena
          </label>
        </div>
      )}
      <div className="flex gap-2 md:col-span-2">
        <Button onClick={() => void save()} disabled={busy || problems.length > 0 || (warnings.length > 0 && !confirmed)}>
          {busy ? 'Spremanje…' : 'Evidentiraj uplatu bez računa'}
        </Button>
        <Button variant="ghost" onClick={onClose}>
          Odustani
        </Button>
      </div>
    </div>
  );
}
