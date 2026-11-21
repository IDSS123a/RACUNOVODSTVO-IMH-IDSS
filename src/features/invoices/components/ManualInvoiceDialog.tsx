import { useCallback, useMemo, useState } from 'react';
import { FileTextIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';
import { ErrorBlock, LoadingBlock } from '@/components/feedback';
import { FormDialog } from '@/components/form-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatKM, sum } from '@/features/billing/money';
import { getFamily, listFamilies } from '@/features/families/repository';
import type { FamilyDetail, FamilySummary } from '@/features/families/types';
import type { LegalEntityCode } from '@/features/price-lists/types';
import { Field } from '@/features/settings/components/OperatorForm';
import { useAsyncResult } from '@/lib/use-async-result';
import { dueDateForMonth } from '../domain';
import { buildManualInvoice, rowTotal, type ManualRowInput, type ManualUnit } from '../manual';
import { issueInvoices } from '../repository';
import type { BillingMonth } from '../types';
import { InvoicePdfDialog } from './InvoicePdfDialog';
import { TemplateText } from './TemplateText';
import { BASIS_TEMPLATES, SERVICE_TEMPLATES } from '../text-templates';

const lineTotalText = (total: number | null): string => (total === null ? '—' : formatKM(total));

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/** A form row with a stable React key (rows can be removed from the middle). */
type FormRow = ManualRowInput & { readonly key: string };

const emptyRow = (): FormRow => ({ key: crypto.randomUUID(), description: '', unit: 'srv', quantity: '1', unitPrice: '' });

/**
 * „Novi račun“ (specs/manual-invoice, F2): an invoice for one child for a service outside the price list.
 * Price-list items are billed by „Mjesečni računi“ (BR-26) and „Račun za upis“ (BR-9, BR-10), never here (M8).
 */
export function ManualInvoiceDialog({ open, onOpenChange, onCreated }: { open: boolean; onOpenChange: (open: boolean) => void; onCreated: () => void }): React.JSX.Element {
  const [createdId, setCreatedId] = useState<string | null>(null);
  return (
    <>
      <FormDialog
        open={open}
        onOpenChange={onOpenChange}
        title="Novi račun — privremena usluga"
        description="Samo za dijete koje nije redovno upisano u ustanovu i privremeno koristi uslugu (npr. pohađa samo ljetnu školu). Upisanom djetetu svi troškovi, i dodatne usluge, idu na njegov mjesečni račun („Mjesečni računi“)."
        wide
      >
        {open && (
          <ManualInvoiceForm
            onCreated={(id) => {
              onOpenChange(false);
              onCreated();
              setCreatedId(id);
            }}
          />
        )}
      </FormDialog>
      <InvoicePdfDialog invoiceId={createdId} onClose={() => setCreatedId(null)} />
    </>
  );
}

function ManualInvoiceForm({ onCreated }: { onCreated: (invoiceId: string) => void }): React.JSX.Element {
  const families = useAsyncResult(listFamilies);
  const [familyId, setFamilyId] = useState('');
  if (families.state.status === 'loading') return <LoadingBlock />;
  if (families.state.status === 'error') return <ErrorBlock message={families.state.error} onRetry={families.reload} />;
  const sorted = [...families.state.data].sort((a, b) => a.displayName.localeCompare(b.displayName, 'bs'));
  return (
    <div className="grid gap-4">
      <FamilyPicker families={sorted} value={familyId} onChange={setFamilyId} />
      {familyId && <FamilyForm key={familyId} familyId={familyId} onCreated={onCreated} />}
    </div>
  );
}

function FamilyPicker({ families, value, onChange }: { families: ReadonlyArray<FamilySummary>; value: string; onChange: (id: string) => void }): React.JSX.Element {
  return (
    <Field id="manual-family" label="Porodica (kupac)">
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id="manual-family" className="w-full sm:w-96">
          <SelectValue placeholder="— Odaberite porodicu —" />
        </SelectTrigger>
        <SelectContent>
          {families.map((f) => (
            <SelectItem key={f.id} value={f.id}>
              {f.displayName}
              {f.payerName ? ` — ${f.payerName}` : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </Field>
  );
}

function FamilyForm({ familyId, onCreated }: { familyId: string; onCreated: (invoiceId: string) => void }): React.JSX.Element {
  const load = useCallback(() => getFamily(familyId), [familyId]);
  const family = useAsyncResult(load);
  if (family.state.status === 'loading') return <LoadingBlock />;
  if (family.state.status === 'error') return <ErrorBlock message={family.state.error} onRetry={family.reload} />;
  return <InvoiceForm detail={family.state.data} onCreated={onCreated} />;
}

function InvoiceForm({ detail, onCreated }: { detail: FamilyDetail; onCreated: (invoiceId: string) => void }): React.JSX.Element {
  const [entity, setEntity] = useState<LegalEntityCode>('IMH');
  const [childId, setChildId] = useState(detail.children.length === 1 ? (detail.children[0]?.id ?? '') : '');
  const [month, setMonth] = useState<string>(today().slice(0, 7));
  const [issueDate, setIssueDate] = useState(today());
  const [dueEdited, setDueEdited] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [rows, setRows] = useState<FormRow[]>(() => [emptyRow()]);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);

  // Due date follows the document's rule (the 5th, or issue + 5 days) until the operator changes it (M6).
  const defaultDue = month && issueDate ? dueDateForMonth(month as BillingMonth, issueDate) : '';
  const dueDate = dueEdited ?? defaultDue;
  const buyer = detail.guardians.find((g) => g.isPayer);

  const result = useMemo(
    () => buildManualInvoice(detail, { entity, childId, month: month as BillingMonth | '', issueDate, dueDate, reason, rows }),
    [detail, entity, childId, month, issueDate, dueDate, reason, rows],
  );
  const totals = rows.map(rowTotal);
  const salesValue = sum(totals.map((t) => t.total ?? 0));

  const setRow = (index: number, change: Partial<ManualRowInput>) => setRows((all) => all.map((r, i) => (i === index ? { ...r, ...change } : r)));

  async function create(): Promise<void> {
    setSubmitted(true);
    if (!result.ok) return;
    setBusy(true);
    try {
      const id = crypto.randomUUID();
      const { draft } = result;
      const issued = await issueInvoices([{ ...draft, id, kind: 'OTHER', lines: [...draft.lines], planItems: [] }]);
      if (issued.success) {
        toast.success(`Račun ${issued.data[0] ?? ''} je uspješno kreiran.`);
        onCreated(id);
      } else toast.error(issued.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      <p className="text-sm text-muted-foreground">
        Kupac na računu: <strong>{buyer?.fullName ?? '—'}</strong> · Adresa: <strong>{detail.family.address || '—'}</strong>
      </p>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field id="manual-entity" label="Ustanova">
          <Select value={entity} onValueChange={(v) => setEntity(v as LegalEntityCode)}>
            <SelectTrigger id="manual-entity">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="IMH">IMH — International Montessori House</SelectItem>
              <SelectItem value="IDSS">IDSS — Internationale Deutsche Schule</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field id="manual-child" label="Dijete">
          <Select value={childId} onValueChange={setChildId}>
            <SelectTrigger id="manual-child">
              <SelectValue placeholder="— Odaberite dijete —" />
            </SelectTrigger>
            <SelectContent>
              {detail.children.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.firstName} {c.lastName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field id="manual-month" label="Obračunski mjesec">
          <Input id="manual-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </Field>
        <Field id="manual-issue" label="Datum izdavanja">
          <Input id="manual-issue" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
        </Field>
        <Field id="manual-due" label="Rok plaćanja">
          <Input id="manual-due" type="date" value={dueDate} onChange={(e) => setDueEdited(e.target.value)} />
        </Field>
        <Field id="manual-number" label="Broj računa">
          <p className="pt-2 text-sm text-muted-foreground">dodjeljuje se pri kreiranju ({entity}-…)</p>
        </Field>
      </div>
      <TemplateText id="manual-reason" label="Osnov (odluka, ugovor ili obavijest)" templates={BASIS_TEMPLATES} onChange={(text) => setReason(text ?? '')} />

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Naziv usluge / artikla</TableHead>
            <TableHead className="w-24">JM</TableHead>
            <TableHead className="w-24">Količina</TableHead>
            <TableHead className="w-32">Cijena (KM)</TableHead>
            <TableHead className="w-32 text-right">Ukupno</TableHead>
            <TableHead className="w-10" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row, index) => (
            <TableRow key={row.key}>
              <TableCell>
                <TemplateText
                  id={`manual-desc-${row.key}`}
                  label={`Naziv usluge, red ${index + 1}`}
                  templates={SERVICE_TEMPLATES}
                  onChange={(text) => setRows((all) => all.map((r) => (r.key === row.key ? { ...r, description: text ?? '' } : r)))}
                />
              </TableCell>
              <TableCell>
                <select
                  aria-label={`JM, red ${index + 1}`}
                  className="h-9 w-full rounded-md border bg-transparent px-2 text-sm"
                  value={row.unit}
                  onChange={(e) => setRow(index, { unit: e.target.value as ManualUnit })}
                >
                  <option value="srv">srv</option>
                  <option value="kom">kom</option>
                </select>
              </TableCell>
              <TableCell>
                <Input aria-label={`Količina, red ${index + 1}`} inputMode="numeric" value={row.quantity} onChange={(e) => setRow(index, { quantity: e.target.value })} />
              </TableCell>
              <TableCell>
                <Input aria-label={`Cijena, red ${index + 1}`} inputMode="decimal" placeholder="0,00" value={row.unitPrice} onChange={(e) => setRow(index, { unitPrice: e.target.value })} />
              </TableCell>
              <TableCell className="text-right tabular-nums">{lineTotalText(totals[index]?.total ?? null)}</TableCell>
              <TableCell>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Ukloni red ${index + 1}`}
                  disabled={rows.length === 1}
                  onClick={() => setRows((all) => all.filter((_, i) => i !== index))}
                >
                  <Trash2Icon aria-hidden />
                </Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <Button variant="outline" onClick={() => setRows((all) => [...all, emptyRow()])}>
          <PlusIcon aria-hidden /> Dodaj stavku
        </Button>
        <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1 text-sm">
          <dt>Prodajna vrijednost</dt>
          <dd className="text-right tabular-nums">{formatKM(salesValue)}</dd>
          <dt>Odobreni rabat</dt>
          <dd className="text-right tabular-nums">{formatKM(0)}</dd>
          <dt className="font-semibold">UKUPNO ZA UPLATU</dt>
          <dd className="text-right font-semibold tabular-nums">{formatKM(salesValue)}</dd>
        </dl>
      </div>
      <p className="text-xs text-muted-foreground">Rabat na ručnom računu nije moguć: svako umanjenje zahtijeva zapisanu odluku UO IMH / ŠO IDSS (BR-7).</p>

      {submitted && !result.ok && (
        <Alert variant="destructive">
          <AlertTitle>Račun nije kreiran</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {result.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
      <div>
        <Button disabled={busy} onClick={() => void create()}>
          <FileTextIcon aria-hidden /> {busy ? 'Kreiram…' : 'Kreiraj račun'}
        </Button>
      </div>
    </div>
  );
}
