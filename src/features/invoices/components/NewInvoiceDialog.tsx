import { useCallback, useEffect, useMemo, useState } from 'react';
import { FileTextIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';
import { ErrorBlock, LoadingBlock } from '@/components/feedback';
import { FormDialog } from '@/components/form-dialog';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatKM, sum } from '@/features/billing/money';
import { PricingError } from '@/features/billing/pricing';
import { listBoardRules, listBreakfast } from '@/features/board-rules/repository';
import { getFamily, listFamilies } from '@/features/families/repository';
import type { FamilyDetail, FamilySummary } from '@/features/families/types';
import { listPriceItems } from '@/features/price-lists/repository';
import { PROGRAM_LABEL, type LegalEntityCode, type SchoolYear } from '@/features/price-lists/types';
import type { Result } from '@/lib/tauri/invoke';
import { useAsyncResult } from '@/lib/use-async-result';
import { acceptPlanProposals, loadInstitutionFamilies, type InstitutionFamilies } from '../actions';
import { buildImhMonthlyInvoices, dueDateForMonth, InvoiceError, monthBounds, monthLabel } from '../domain';
import { buildManualInvoice, countsAsMonthlyBilled, rowTotal, serviceKey, type ManualRowInput } from '../manual';
import { familyPreview, finalDrafts, previewProblem, type PreviewInvoice } from '../monthly';
import { enrolmentPreview, entitiesOfChild, newInvoiceMode, type NewInvoiceMode } from '../new-invoice';
import { buildIdssMonthlyInvoices, defaultIdssPlan } from '../plans';
import { issueInvoices, listBilledOneTime, listBilledServices, listInvoices, listPaymentPlans } from '../repository';
import { BASIS_TEMPLATES, SERVICE_TEMPLATES } from '../text-templates';
import type { BillingMonth } from '../types';
import { InvoicePdfDialog } from './InvoicePdfDialog';
import { PrepaymentOffer } from './PrepaymentOffer';
import { PreviewInvoiceTable } from './PreviewInvoiceTable';
import { UnitInput } from './UnitInput';
import { TemplateText } from './TemplateText';

const today = (): string => new Date().toISOString().slice(0, 10);
const SELECT = 'h-9 w-full rounded-md border bg-transparent px-2 text-sm sm:max-w-md';

/**
 * „Novi račun“ (Director, 2026-11-21): pick the child — the system recognizes what is due and proposes the invoice
 * (`new-invoice.ts`): the monthly invoice of a child attending, the enrolment invoice of a child enrolled for a later
 * period, or a temporary service for a child not enrolled. A compact table, one row under the other.
 */
export function NewInvoiceDialog({
  open,
  onOpenChange,
  onCreated,
  defaultEntity = 'IMH',
  lockEntity = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
  /** The institution of the guided flow the dialog is opened from. */
  defaultEntity?: LegalEntityCode;
  /** Opened inside one institution's flow: the institution cannot be changed (Director, 2026-11-21). */
  lockEntity?: boolean;
}): React.JSX.Element {
  const [createdId, setCreatedId] = useState<string | null>(null);
  // Q2 (specs/family-advance): a child in prepayment — the offer to apply it comes before the PDF is shown
  const [offerId, setOfferId] = useState<string | null>(null);
  return (
    <>
      <FormDialog open={open} onOpenChange={onOpenChange} title="Novi račun" description="Odaberite porodicu i dijete — sistem predlaže račun, vi ga provjerite i kreirate." wide>
        {open && (
          <Chooser
            defaultEntity={defaultEntity}
            lockEntity={lockEntity}
            onCreated={(id) => {
              onOpenChange(false);
              onCreated();
              setOfferId(id);
            }}
          />
        )}
      </FormDialog>
      {offerId && (
        <PrepaymentOffer
          asDialog
          invoiceIds={[offerId]}
          onApplied={() => {
            onCreated();
            setCreatedId(offerId);
            setOfferId(null);
          }}
          onNothing={() => {
            setCreatedId(offerId);
            setOfferId(null);
          }}
          onSkip={() => {
            setCreatedId(offerId);
            setOfferId(null);
          }}
        />
      )}
      <InvoicePdfDialog invoiceId={createdId} onClose={() => setCreatedId(null)} />
    </>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <tr className="border-b last:border-b-0">
      <th className="w-40 py-2 pr-3 text-left align-middle font-medium text-muted-foreground">{label}</th>
      <td className="py-2">{children}</td>
    </tr>
  );
}

function Chooser({ onCreated, defaultEntity, lockEntity }: { onCreated: (invoiceId: string) => void; defaultEntity: LegalEntityCode; lockEntity: boolean }): React.JSX.Element {
  const families = useAsyncResult(listFamilies);
  // inside one institution's flow only that institution's families and children (families/membership.ts)
  const loadOwn = useCallback(
    () => (lockEntity ? loadInstitutionFamilies(defaultEntity, today()) : Promise.resolve({ success: true, data: null } as const)),
    [lockEntity, defaultEntity],
  );
  const own = useAsyncResult<InstitutionFamilies | null>(loadOwn as () => Promise<Result<InstitutionFamilies | null>>);
  const [familyId, setFamilyId] = useState('');
  if (families.state.status === 'loading' || own.state.status === 'loading') return <LoadingBlock />;
  if (families.state.status === 'error') return <ErrorBlock message={families.state.error} onRetry={families.reload} />;
  if (own.state.status === 'error') return <ErrorBlock message={own.state.error} onRetry={own.reload} />;
  const scope = own.state.data;
  const familyIds = scope ? new Set(scope.families.map((f) => f.family.id)) : null;
  const sorted = families.state.data.filter((f) => !familyIds || familyIds.has(f.id)).sort((a, b) => a.displayName.localeCompare(b.displayName, 'bs'));
  return (
    <FamilyStep
      families={sorted}
      childIds={scope?.childIds ?? null}
      familyId={familyId}
      onFamily={setFamilyId}
      onCreated={onCreated}
      defaultEntity={defaultEntity}
      lockEntity={lockEntity}
    />
  );
}

function FamilyStep({
  families,
  childIds,
  familyId,
  onFamily,
  onCreated,
  defaultEntity,
  lockEntity,
}: {
  families: FamilySummary[];
  /** The children of the flow's institution; null = every child (outside a flow). */
  childIds: ReadonlySet<string> | null;
  familyId: string;
  onFamily: (id: string) => void;
  onCreated: (id: string) => void;
  defaultEntity: LegalEntityCode;
  lockEntity: boolean;
}): React.JSX.Element {
  const load = useCallback(() => (familyId ? getFamily(familyId) : Promise.resolve({ success: true, data: null } as const)), [familyId]);
  const family = useAsyncResult<FamilyDetail | null>(load as () => Promise<Result<FamilyDetail | null>>);
  const detail = family.state.status === 'ready' ? family.state.data : null;
  const [childId, setChildId] = useState('');
  const [entity, setEntity] = useState<LegalEntityCode>(defaultEntity);
  const [month, setMonth] = useState(today().slice(0, 7));
  const [issueDate, setIssueDate] = useState(today());

  // the institution follows the child's enrolment; only a child enrolled in both lets the operator choose
  const childEntities = detail && childId ? entitiesOfChild(detail, childId) : [];
  useEffect(() => {
    if (!lockEntity && childEntities.length === 1 && childEntities[0]) setEntity(childEntities[0]);
  }, [childEntities.join()]); // eslint-disable-line react-hooks/exhaustive-deps
  // inside one institution's flow only that institution's children are offered (families/membership.ts)
  const offered = detail ? detail.children.filter((c) => !childIds || childIds.has(c.id)) : [];

  const mode: NewInvoiceMode | null = detail && childId && month ? newInvoiceMode(detail, childId, entity, month as BillingMonth) : null;
  const modeText =
    mode?.mode === 'MONTHLY'
      ? `Mjesečni račun — dijete pohađa ${PROGRAM_LABEL[mode.enrolment.program]} u mjesecu ${monthLabel(month as BillingMonth)}`
      : mode?.mode === 'ENROLMENT'
        ? `Račun za upis ${mode.enrolment.schoolYear} (${PROGRAM_LABEL[mode.enrolment.program]}, od ${mode.enrolment.startsOn.split('-').reverse().join('.')}.) — upisnina, materijal i depozit plaćaju se prije početka`
        : mode?.mode === 'MANUAL'
          ? `Privremena usluga — dijete nije upisano u ${entity} (npr. samo ljetna škola)`
          : '—';

  return (
    <div className="grid gap-4">
      <table className="w-full text-sm">
        <tbody>
          <Row label="Porodica (kupac)">
            <select
              aria-label="Porodica"
              className={SELECT}
              value={familyId}
              onChange={(e) => {
                onFamily(e.target.value);
                setChildId('');
              }}
            >
              <option value="">— odaberite porodicu —</option>
              {families.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.displayName}
                  {f.payerName ? ` — ${f.payerName}` : ''}
                </option>
              ))}
            </select>
          </Row>
          {family.state.status === 'error' && (
            <Row label="">
              <span className="text-destructive">{family.state.error}</span>
            </Row>
          )}
          {detail && (
            <>
              <Row label="Kupac i adresa">
                {detail.guardians.find((g) => g.isPayer)?.fullName ?? '—'} · {detail.family.address || 'adresa nije unesena'}
              </Row>
              <Row label="Dijete">
                <select aria-label="Dijete" className={SELECT} value={childId} onChange={(e) => setChildId(e.target.value)}>
                  <option value="">— odaberite dijete —</option>
                  {offered.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.firstName} {c.lastName}
                    </option>
                  ))}
                </select>
              </Row>
              {childId && (
                <>
                  <Row label="Ustanova">
                    {lockEntity || childEntities.length === 1 ? (
                      <span className="font-medium">{entity}</span>
                    ) : (
                      <select aria-label="Ustanova" className={SELECT} value={entity} onChange={(e) => setEntity(e.target.value as LegalEntityCode)}>
                        <option value="IMH">IMH — International Montessori House</option>
                        <option value="IDSS">IDSS — Internationale Deutsche Schule</option>
                      </select>
                    )}
                  </Row>
                  <Row label="Mjesec">
                    <Input aria-label="Mjesec" type="month" className="h-9 w-48" value={month} onChange={(e) => setMonth(e.target.value || today().slice(0, 7))} />
                  </Row>
                  <Row label="Datum izdavanja">
                    <Input aria-label="Datum izdavanja" type="date" className="h-9 w-48" value={issueDate} onChange={(e) => setIssueDate(e.target.value || today())} />
                  </Row>
                  <Row label="Vrsta računa">
                    <span className="font-medium">{modeText}</span>
                  </Row>
                </>
              )}
            </>
          )}
        </tbody>
      </table>

      {detail && childId && mode && mode.mode !== 'MANUAL' && (
        <ProposalStep key={`${childId}|${entity}|${month}|${issueDate}`} detail={detail} childId={childId} entity={entity} month={month as BillingMonth} issueDate={issueDate} mode={mode} onCreated={onCreated} />
      )}
      {detail && childId && mode?.mode === 'MANUAL' && (
        <ManualStep key={`${childId}|${entity}`} detail={detail} childId={childId} entity={entity} month={month as BillingMonth} issueDate={issueDate} onCreated={onCreated} />
      )}
    </div>
  );
}

type Proposal = { status: 'ready'; preview: PreviewInvoice } | { status: 'info'; message: string; plan?: Parameters<typeof acceptPlanProposals>[0][number] };

async function loadProposal(detail: FamilyDetail, childId: string, entity: LegalEntityCode, month: BillingMonth, issueDate: string, mode: NewInvoiceMode): Promise<Result<Proposal>> {
  if (mode.mode === 'MANUAL') return { success: true, data: { status: 'info', message: '' } };
  const schoolYear = mode.enrolment.schoolYear as SchoolYear;
  const [prices, plans, billed, rules, breakfast, existing] = await Promise.all([
    listPriceItems(schoolYear),
    listPaymentPlans(schoolYear),
    listBilledOneTime(schoolYear),
    listBoardRules(schoolYear),
    listBreakfast(schoolYear),
    listInvoices({ entity, month }),
  ]);
  if (!prices.success) return prices;
  if (!plans.success) return plans;
  if (!billed.success) return billed;
  if (!rules.success) return rules;
  if (!breakfast.success) return breakfast;
  if (!existing.success) return existing;
  try {
    if (mode.mode === 'ENROLMENT') {
      const preview = enrolmentPreview(detail, prices.data, plans.data, mode.enrolment, billed.data, issueDate);
      return { success: true, data: preview ? { status: 'ready', preview } : { status: 'info', message: 'Upisni troškovi za ovaj upis su već fakturisani — nema šta izdati.' } };
    }
    const already = existing.data.find((i) => i.childId === childId && countsAsMonthlyBilled(i));
    if (already) return { success: true, data: { status: 'info', message: `Dijete već ima račun ${already.number} za ${monthLabel(month)}. Ispravka ide kroz knjižno odobrenje na tom računu.` } };
    const idssRules = rules.data.find((r) => r.entity === 'IDSS') ?? null;
    const imh = buildImhMonthlyInvoices(detail, prices.data, [], month, issueDate);
    const idss = buildIdssMonthlyInvoices(detail, plans.data, { priceItems: prices.data, rules: idssRules, breakfast: new Set(breakfast.data) }, month, issueDate);
    const family = familyPreview(detail, imh, idss.drafts, prices.data, plans.data, billed.data, month, issueDate);
    const preview = family.previews.find((p) => p.header.childId === childId && p.header.entity === entity);
    if (preview) return { success: true, data: { status: 'ready', preview } };
    // an IDSS pupil without a plan: the proposed plan to approve, then the invoice
    if (entity === 'IDSS' && !plans.data.some((p) => p.enrolmentId === mode.enrolment.id && p.itemCode === 'TUITION')) {
      const plan = defaultIdssPlan(detail, prices.data, mode.enrolment.id, 'TUITION', idssRules?.lastInstalmentBy ?? null);
      const child = detail.children.find((c) => c.id === childId);
      return {
        success: true,
        data: {
          status: 'info',
          message: `Učenik nema plan plaćanja. Sistem predlaže ${formatKM(plan.total)} u ${plan.instalments} rata po ${formatKM(plan.items[0]?.amount ?? 0)}.`,
          plan: {
            familyName: detail.family.displayName,
            childName: child ? `${child.firstName} ${child.lastName}` : '',
            plan: {
              id: crypto.randomUUID(), enrolmentId: mode.enrolment.id, childId, itemCode: 'TUITION', instalments: plan.instalments, total: plan.total,
              items: plan.items.map((i) => ({ ...i, invoiceId: null })),
            },
          },
        },
      };
    }
    const reasons = [...idss.problems, ...family.problems];
    return { success: true, data: { status: 'info', message: reasons.length > 0 ? reasons.join(' · ') : `Za ${monthLabel(month)} nema stavki za naplatu.` } };
  } catch (error: unknown) {
    if (error instanceof InvoiceError || error instanceof PricingError) {
      return { success: true, data: { status: 'info', message: `${error.message}${error instanceof PricingError ? ` — provjerite da li je cjenovnik za ${schoolYear} unesen.` : ''}` } };
    }
    throw error;
  }
}

function ProposalStep(props: { detail: FamilyDetail; childId: string; entity: LegalEntityCode; month: BillingMonth; issueDate: string; mode: NewInvoiceMode; onCreated: (id: string) => void }): React.JSX.Element {
  const { detail, childId, entity, month, issueDate, mode, onCreated } = props;
  const load = useCallback(() => loadProposal(detail, childId, entity, month, issueDate, mode), [detail, childId, entity, month, issueDate, mode]);
  const proposal = useAsyncResult(load);
  const [edited, setEdited] = useState<PreviewInvoice | null>(null);
  const [busy, setBusy] = useState(false);
  if (proposal.state.status === 'loading') return <LoadingBlock />;
  if (proposal.state.status === 'error') return <ErrorBlock message={proposal.state.error} onRetry={proposal.reload} />;
  const data = proposal.state.data;
  if (data.status === 'info') {
    return (
      <Alert>
        <AlertDescription className="grid gap-2">
          <p>{data.message}</p>
          {data.plan && (
            <div>
              <Button
                size="sm"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  const saved = await acceptPlanProposals(data.plan ? [data.plan] : []);
                  setBusy(false);
                  if (!saved.success) return void toast.error(saved.error);
                  toast.success('Plan plaćanja je sačuvan.');
                  proposal.reload();
                }}
              >
                Prihvati predloženi plan
              </Button>
            </div>
          )}
        </AlertDescription>
      </Alert>
    );
  }
  const preview = edited ?? data.preview;
  const problem = previewProblem(preview);
  async function create(): Promise<void> {
    const [draft] = finalDrafts([preview]);
    if (!draft) return;
    setBusy(true);
    try {
      const result = await issueInvoices([draft]);
      if (result.success) {
        toast.success(`Kreiran račun ${result.data[0] ?? ''}.`);
        onCreated(draft.id);
      } else toast.error(result.error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-3">
      <PreviewInvoiceTable invoice={preview} selectable={false} onChange={(change) => setEdited(change(preview))} />
      {problem && <p className="text-sm text-destructive">{problem}</p>}
      <div>
        <Button disabled={busy || problem !== null} onClick={() => void create()}>
          <FileTextIcon aria-hidden /> {busy ? 'Kreiram…' : 'Kreiraj račun'}
        </Button>
      </div>
    </div>
  );
}

/** A temporary service for a child not enrolled in the institution (DL-P014): lines in a compact table. */
type FormRow = ManualRowInput & { readonly key: string };
const emptyRow = (): FormRow => ({ key: crypto.randomUUID(), description: '', unit: 'srv', quantity: '1', unitPrice: '' });

function ManualStep(props: { detail: FamilyDetail; childId: string; entity: LegalEntityCode; month: BillingMonth; issueDate: string; onCreated: (id: string) => void }): React.JSX.Element {
  const { detail, childId, entity, month, issueDate, onCreated } = props;
  const [reason, setReason] = useState('');
  const [rows, setRows] = useState<FormRow[]>(() => [emptyRow()]);
  const [submitted, setSubmitted] = useState(false);
  const [busy, setBusy] = useState(false);
  const dueDate = dueDateForMonth(month, issueDate);
  const result = useMemo(() => buildManualInvoice(detail, { entity, childId, month, issueDate, dueDate, reason, rows }), [detail, entity, childId, month, issueDate, dueDate, reason, rows]);
  const totals = rows.map(rowTotal);
  const total = sum(totals.map((t) => t.total ?? 0));
  const setRow = (key: string, change: Partial<ManualRowInput>) => setRows((all) => all.map((r) => (r.key === key ? { ...r, ...change } : r)));
  // the same service is never billed twice to a child for the same month (Director, 2026-11-22); the backend refuses it too
  const loadBilled = useCallback(() => listBilledServices(entity, monthBounds(month).from), [entity, month]);
  const billed = useAsyncResult(loadBilled);
  const billedList = billed.state.status === 'ready' ? billed.state.data : [];
  const duplicates = rows.flatMap((r) => {
    const found = r.description.trim() ? billedList.find((b) => b.childId === childId && serviceKey(b.description) === serviceKey(r.description)) : undefined;
    return found ? [`„${r.description.trim()}“ je ovom djetetu za ${monthLabel(month)} već fakturisano (${found.invoiceNumber}).`] : [];
  });

  async function create(): Promise<void> {
    setSubmitted(true);
    if (!result.ok || duplicates.length > 0) return;
    setBusy(true);
    try {
      const id = crypto.randomUUID();
      const issued = await issueInvoices([{ ...result.draft, id, kind: 'OTHER', lines: [...result.draft.lines], planItems: [] }]);
      if (issued.success) {
        toast.success(`Kreiran račun ${issued.data[0] ?? ''}.`);
        onCreated(id);
      } else toast.error(issued.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      <table className="w-full border-collapse overflow-hidden rounded-md border text-sm">
        <thead>
          <tr className="bg-muted/60 text-left">
            <th className="p-2 font-medium">Usluga</th>
            <th className="w-20 p-2 font-medium">JM</th>
            <th className="w-20 p-2 font-medium">Kol.</th>
            <th className="w-28 p-2 font-medium">Cijena (KM)</th>
            <th className="w-28 p-2 text-right font-medium">Iznos</th>
            <th className="w-10" />
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={row.key} className="border-t align-top">
              <td className="p-2">
                <TemplateText id={`svc-${row.key}`} label={`Usluga ${index + 1}`} templates={SERVICE_TEMPLATES} onChange={(text) => setRow(row.key, { description: text ?? '' })} />
              </td>
              <td className="p-2">
                <UnitInput id={`unit-${row.key}`} label={`JM, red ${index + 1}`} className="h-9 w-full" value={row.unit} onChange={(unit) => setRow(row.key, { unit })} />
              </td>
              <td className="p-2">
                <Input aria-label={`Količina, red ${index + 1}`} inputMode="numeric" className="h-9" value={row.quantity} onChange={(e) => setRow(row.key, { quantity: e.target.value })} />
              </td>
              <td className="p-2">
                <Input aria-label={`Cijena, red ${index + 1}`} inputMode="decimal" placeholder="0,00" className="h-9" value={row.unitPrice} onChange={(e) => setRow(row.key, { unitPrice: e.target.value })} />
              </td>
              <td className="p-2 text-right tabular-nums">{totals[index]?.total === null || totals[index] === undefined ? '—' : formatKM(totals[index].total ?? 0)}</td>
              <td className="p-1">
                <Button variant="ghost" size="icon" aria-label={`Ukloni red ${index + 1}`} disabled={rows.length === 1} onClick={() => setRows((all) => all.filter((r) => r.key !== row.key))}>
                  <Trash2Icon aria-hidden />
                </Button>
              </td>
            </tr>
          ))}
          <tr className="border-t">
            <td colSpan={4} className="p-2">
              <Button variant="ghost" size="sm" onClick={() => setRows((all) => [...all, emptyRow()])}>
                <PlusIcon aria-hidden /> Dodaj red
              </Button>
            </td>
            <td className="p-2 text-right font-semibold tabular-nums">{formatKM(total)}</td>
            <td />
          </tr>
          <tr className="border-t">
            <td colSpan={6} className="p-2">
              <TemplateText id="manual-basis" label="Osnov" templates={BASIS_TEMPLATES} onChange={(text) => setReason(text ?? '')} />
            </td>
          </tr>
        </tbody>
      </table>
      {duplicates.length > 0 && (
        <Alert variant="destructive">
          <AlertTitle>Ova usluga je već fakturisana</AlertTitle>
          <AlertDescription>
            <ul className="list-disc pl-4">
              {duplicates.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}
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
        <Button disabled={busy || duplicates.length > 0} onClick={() => void create()}>
          <FileTextIcon aria-hidden /> {busy ? 'Kreiram…' : 'Kreiraj račun'}
        </Button>
      </div>
    </div>
  );
}


