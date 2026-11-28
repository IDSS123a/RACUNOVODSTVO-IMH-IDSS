import { useCallback, useMemo, useState } from 'react';
import { ArrowLeftIcon, CalendarRangeIcon, PencilIcon, PlusIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';
import { ErrorBlock, LoadingBlock } from '@/components/feedback';
import { useConfirm } from '@/components/confirm-dialog';
import { FormDialog } from '@/components/form-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FamilySaldoCard } from '@/features/invoices/components/FamilySaldoCard';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PaymentPlanDialog } from '@/features/invoices/components/PaymentPlanDialog';
import { listPriceItems, listSchoolYears } from '@/features/price-lists/repository';
import { PROGRAM_ENTITY, PROGRAM_LABEL, type SchoolYear } from '@/features/price-lists/types';
import { formatDate } from '@/lib/format';
import { useAsyncResult } from '@/lib/use-async-result';
import { changeEnrolmentStatus, loadAllFamilyDetails, saveFamilyWithGuardians, saveValidatedEnrolment } from '../actions';
import { childDuplicates, familyDuplicates } from '../duplicates';
import { useDuplicateGuard } from './DuplicateDialog';
import { ACTIVE_STATUSES, allowedTransitions, buildFamilyPricing, enrolmentAgeProblem, groupChangeFrom } from '../domain';
import { changeEnrolmentGroup, confirmNotDuplicate, deleteChild, deleteEnrolment, deleteFamily, getFamily, saveChild } from '../repository';
import { Input } from '@/components/ui/input';
import { ROLE_LABEL, STATUS_LABEL, type Child, type Enrolment, type EnrolmentStatus } from '../types';
import { newChild, newEnrolment } from '../factories';
import { ChildForm } from './ChildForm';
import { EnrolmentForm } from './EnrolmentForm';
import { FamilyForm } from './FamilyForm';
import { PricingSummary } from './PricingSummary';

type DialogState =
  | { kind: 'none' }
  | { kind: 'family' }
  | { kind: 'child'; child: Child }
  | { kind: 'enrolment'; enrolment: Enrolment }
  | { kind: 'plan'; enrolment: Enrolment }
  | { kind: 'group'; enrolment: Enrolment };

/** One family: guardians, children, enrolments, and who pays the full / discounted price. */
export function FamilyDetailView({
  familyId,
  defaultYear,
  onBack,
  startWithNewChild = null,
  onOpenFamily,
}: {
  familyId: string;
  defaultYear: SchoolYear;
  onBack: () => void;
  /** Opens another family (from the duplicate warning, SPEC §B). */
  onOpenFamily?: (familyId: string) => void;
  /** The display name of a family just created: its first-child form opens at once. */
  startWithNewChild?: string | null;
}): React.JSX.Element {
  const loadFamily = useCallback(() => getFamily(familyId), [familyId]);
  const loadYears = useCallback(() => listSchoolYears(), []);
  const loadPrices = useCallback(() => listPriceItems(), []);
  const detail = useAsyncResult(loadFamily);
  const years = useAsyncResult(loadYears);
  const prices = useAsyncResult(loadPrices);
  const [year, setYear] = useState<SchoolYear>(defaultYear);
  const [dialog, setDialog] = useState<DialogState>(() =>
    startWithNewChild !== null ? { kind: 'child', child: newChild(familyId, startWithNewChild) } : { kind: 'none' },
  );
  const [confirmDialog, confirm] = useConfirm();
  const [duplicateDialog, askDuplicate] = useDuplicateGuard();

  const pricing = useMemo(() => {
    if (detail.state.status !== 'ready' || prices.state.status !== 'ready') return [];
    return buildFamilyPricing(detail.state.data.children, detail.state.data.enrolments, prices.state.data, year);
  }, [detail.state, prices.state, year]);

  if (detail.state.status === 'loading') return <LoadingBlock />;
  if (detail.state.status === 'error') return <ErrorBlock message={detail.state.error} onRetry={detail.reload} />;
  const { family, guardians, children, enrolments } = detail.state.data;
  const schoolYears = years.state.status === 'ready' ? years.state.data : [defaultYear];
  const close = () => setDialog({ kind: 'none' });

  async function run(action: Promise<{ success: boolean; error?: string }>, ok: string): Promise<boolean> {
    const result = await action;
    if (result.success) {
      toast.success(ok);
      detail.reload();
      return true;
    }
    toast.error(result.error ?? 'Greška');
    return false;
  }

  async function setStatus(enrolment: Enrolment, to: EnrolmentStatus): Promise<void> {
    const endsOn = to === 'WITHDRAWN' || to === 'COMPLETED' ? new Date().toISOString().slice(0, 10) : null;
    const others = enrolments.filter((e) => e.childId === enrolment.childId);
    await run(changeEnrolmentStatus(enrolment, to, others, endsOn), `Status: ${STATUS_LABEL[to]}.`);
  }

  // Director 2026-11-21: deleting what was entered by mistake must work — always after a confirmation; whatever was
  // already invoiced is refused by the backend with the invoice number (accounting records are never deleted).
  async function removeFamily(): Promise<void> {
    const ok = await confirm({
      title: `Obrisati porodicu „${family.displayName}“?`,
      message: `Briše se porodica s roditeljima${children.length > 0 ? `, ${children.length} djece i njihovim upisima` : ''}. Ovo se ne može poništiti. Ako je nešto već fakturisano, brisanje se odbija.`,
      confirmLabel: 'Obriši porodicu',
      destructive: true,
    });
    if (ok && (await run(deleteFamily(family.id), 'Porodica je obrisana.'))) onBack();
  }

  async function removeChild(child: Child): Promise<void> {
    const count = enrolments.filter((e) => e.childId === child.id).length;
    const ok = await confirm({
      title: `Obrisati dijete ${child.firstName} ${child.lastName}?`,
      message: `${count > 0 ? `Briše se i ${count} upis(a) djeteta. ` : ''}Ovo se ne može poništiti. Ako dijete ima račun, brisanje se odbija — tada koristite ispis.`,
      confirmLabel: 'Obriši dijete',
      destructive: true,
    });
    if (ok) await run(deleteChild(child.id), 'Dijete je obrisano.');
  }

  async function removeEnrolment(enrolment: Enrolment): Promise<void> {
    const ok = await confirm({
      title: 'Obrisati upis?',
      message: `${PROGRAM_LABEL[enrolment.program]}, ${enrolment.schoolYear}. Briše se i nefakturisani plan plaćanja. Ovo se ne može poništiti. Ako je upis već fakturisan, brisanje se odbija — tada koristite ispis.`,
      confirmLabel: 'Obriši upis',
      destructive: true,
    });
    if (ok) await run(deleteEnrolment(enrolment.id), 'Upis je obrisan.');
  }

  return (
    <div className="grid gap-6">
      {confirmDialog}
      {duplicateDialog}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" aria-label="Nazad na listu porodica" onClick={onBack}>
            <ArrowLeftIcon aria-hidden />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{family.displayName}</h1>
            <p className="text-sm text-muted-foreground">{family.address || 'Adresa nije unesena'}</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setDialog({ kind: 'family' })}>
            <PencilIcon aria-hidden /> Uredi porodicu
          </Button>
          <Button variant="ghost" onClick={() => void removeFamily()}>
            <Trash2Icon aria-hidden /> Obriši
          </Button>
        </div>
      </header>

      <FamilySaldoCard familyId={familyId} childList={children} guardians={guardians} />

      <Card>
        <CardHeader>
          <CardTitle>Roditelji / staratelji</CardTitle>
          <CardDescription>Kupac na računu je osoba na koju glase računi. IBAN se koristi samo za povrat subvencije Ministarstva.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-2">
          {guardians.map((g) => (
            <div key={g.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="font-medium">{g.fullName}</span>
              <span className="text-muted-foreground">{ROLE_LABEL[g.role]}</span>
              {g.isPayer && <Badge>Kupac na računu</Badge>}
              {g.email && <span>{g.email}</span>}
              {g.phone && <span>{g.phone}</span>}
              {g.iban && <span className="font-mono text-xs">{g.iban}</span>}
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Djeca i upisi</CardTitle>
          <CardDescription>Redoslijed po datumu rođenja određuje ko ima popust (mlađe dijete, unutar iste ustanove).</CardDescription>
          <CardAction>
            <Button onClick={() => setDialog({ kind: 'child', child: newChild(family.id, family.displayName) })}>
              <PlusIcon aria-hidden /> Dodaj dijete
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="grid gap-4">
          {children.length === 0 && <p className="text-sm text-muted-foreground">Porodica još nema upisane djece.</p>}
          {children.map((child) => {
            const own = enrolments.filter((e) => e.childId === child.id);
            return (
              <div key={child.id} className="grid gap-3 rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="font-medium">
                      {child.firstName} {child.lastName}
                      {child.importReview && (
                        <Badge variant="destructive" className="ml-2">
                          Dopuniti podatke (uvoz)
                        </Badge>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {child.dateOfBirth ? `rođen/a ${formatDate(child.dateOfBirth)}` : 'datum rođenja nije unesen'} · {child.residency === 'DOMESTIC' ? 'domaće lice' : 'strano lice'}
                      {!child.citizenBih || !child.residenceKs ? ' · nema uslove za subvenciju' : ''}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'enrolment', enrolment: newEnrolment(child.id, year, child.dateOfBirth) })}>
                      <PlusIcon aria-hidden /> Upis
                    </Button>
                    <Button size="sm" variant="ghost" aria-label="Uredi dijete" onClick={() => setDialog({ kind: 'child', child })}>
                      <PencilIcon aria-hidden />
                    </Button>
                    <Button size="sm" variant="ghost" aria-label="Obriši dijete" onClick={() => void removeChild(child)}>
                      <Trash2Icon aria-hidden />
                    </Button>
                  </div>
                </div>
                {own.map((enrolment) => (
                  <div key={enrolment.id} className="flex flex-wrap items-center gap-3 border-t pt-3 text-sm">
                    <Badge className={PROGRAM_ENTITY[enrolment.program] === 'IMH' ? 'bg-entity-imh-soft text-entity-imh' : 'bg-entity-idss-soft text-entity-idss'}>
                      {PROGRAM_ENTITY[enrolment.program]}
                    </Badge>
                    <span className="font-medium">{PROGRAM_LABEL[enrolment.program]}</span>
                    <span>{enrolment.schoolYear}</span>
                    <span className="text-muted-foreground">od {formatDate(enrolment.startsOn)}{enrolment.endsOn ? ` do ${formatDate(enrolment.endsOn)}` : ''}</span>
                    <Badge variant="outline">{STATUS_LABEL[enrolment.status]}</Badge>
                    {ACTIVE_STATUSES.has(enrolment.status) && enrolmentAgeProblem(enrolment.program, child.dateOfBirth, enrolment.startsOn) && (
                      <p role="alert" className="basis-full text-destructive">
                        Upis ne odgovara starosti djeteta: {enrolmentAgeProblem(enrolment.program, child.dateOfBirth, enrolment.startsOn)}
                      </p>
                    )}
                    <div className="ml-auto flex flex-wrap gap-1">
                      {ACTIVE_STATUSES.has(enrolment.status) && groupChangeFrom(enrolment, child.dateOfBirth) !== null && (
                        <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'group', enrolment })}>
                          Promijeni grupu → {enrolment.program === 'TODDLERS' ? 'Preschoolers' : 'Toddlers'}
                        </Button>
                      )}
                      {PROGRAM_ENTITY[enrolment.program] === 'IDSS' && (
                        <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'plan', enrolment })}>
                          <CalendarRangeIcon aria-hidden /> Plan plaćanja
                        </Button>
                      )}
                      {allowedTransitions(enrolment.status).map((to) => (
                        <Button key={to} size="sm" variant="ghost" onClick={() => void setStatus(enrolment, to)}>
                          → {STATUS_LABEL[to]}
                        </Button>
                      ))}
                      <Button size="sm" variant="ghost" aria-label="Obriši upis" onClick={() => void removeEnrolment(enrolment)}>
                        <Trash2Icon aria-hidden />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ko plaća puni, a ko umanjeni iznos</CardTitle>
          <CardDescription>Prema cjenovniku i redoslijedu djece u istoj ustanovi. Iznosi su informativni; računi se izdaju u modulu Računi.</CardDescription>
          <CardAction>
            <Select value={year} onValueChange={(value) => setYear(value as SchoolYear)}>
              <SelectTrigger className="w-40" aria-label="Školska godina">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {schoolYears.map((schoolYear) => (
                  <SelectItem key={schoolYear} value={schoolYear}>
                    {schoolYear}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardAction>
        </CardHeader>
        <CardContent>
          {prices.state.status === 'error' ? <ErrorBlock message={prices.state.error} onRetry={prices.reload} /> : <PricingSummary lines={pricing} />}
        </CardContent>
      </Card>

      <FormDialog open={dialog.kind === 'family'} onOpenChange={close} title="Uredi porodicu" wide>
        <FamilyForm
          family={family}
          guardians={guardians}
          submitLabel="Sačuvaj"
          onSubmit={async (f, g) => {
            const all = await loadAllFamilyDetails();
            if (!all.success) return void toast.error(all.error);
            const similar = familyDuplicates({ family: f, guardians: g }, all.data);
            if (similar.length > 0) {
              const answer = await askDuplicate(similar, 'Porodica');
              if (answer.kind === 'back') return;
              if (answer.kind === 'open') return void onOpenFamily?.(answer.familyId);
            }
            if (!(await run(saveFamilyWithGuardians(f, g), 'Porodica je sačuvana.'))) return;
            if (similar.length > 0) await confirmNotDuplicate('family', f.id, similar.map((m) => m.familyId));
            close();
          }}
        />
      </FormDialog>
      <FormDialog open={dialog.kind === 'child'} onOpenChange={close} title="Dijete">
        {dialog.kind === 'child' && (
          <ChildForm
            child={dialog.child}
            onSubmit={async (child) => {
              // possible duplicate child (SPEC §B): the same child twice in this family is refused, elsewhere a warning
              const all = await loadAllFamilyDetails();
              if (!all.success) return void toast.error(all.error);
              const duplicate = childDuplicates(child, all.data);
              if (duplicate.blocking) return void toast.error(duplicate.blocking);
              if (duplicate.matches.length > 0) {
                const answer = await askDuplicate(duplicate.matches, `Dijete ${child.firstName} ${child.lastName}`);
                if (answer.kind === 'back') return;
                if (answer.kind === 'open') return void onOpenFamily?.(answer.familyId);
              }
              const isNew = !children.some((c) => c.id === child.id);
              if (!(await run(saveChild(child), 'Dijete je sačuvano.'))) return;
              if (duplicate.matches.length > 0) await confirmNotDuplicate('child', child.id, duplicate.matches.map((m) => m.familyId));
              // a new child is enrolled next, without searching for the button (Director, 2026-11-21)
              if (isNew) setDialog({ kind: 'enrolment', enrolment: newEnrolment(child.id, year, child.dateOfBirth) });
              else close();
            }}
          />
        )}
      </FormDialog>
      <FormDialog open={dialog.kind === 'enrolment'} onOpenChange={close} title="Novi upis" description="Program određuje ustanovu. Novi upis čeka uplatu upisnih troškova.">
        {dialog.kind === 'enrolment' && (
          <EnrolmentForm
            enrolment={dialog.enrolment}
            dateOfBirth={children.find((c) => c.id === dialog.enrolment.childId)?.dateOfBirth ?? null}
            schoolYears={schoolYears}
            onSubmit={async (enrolment) => {
              const others = enrolments.filter((e) => e.childId === enrolment.childId);
              const dateOfBirth = children.find((c) => c.id === enrolment.childId)?.dateOfBirth ?? null;
              if (!(await run(saveValidatedEnrolment(enrolment, others, dateOfBirth), 'Dijete je upisano.'))) return;
              // an IDSS pupil needs a payment plan: the proposed one opens at once, the operator only confirms it
              if (PROGRAM_ENTITY[enrolment.program] === 'IDSS') setDialog({ kind: 'plan', enrolment });
              else close();
            }}
          />
        )}
      </FormDialog>
      <FormDialog
        open={dialog.kind === 'group'}
        onOpenChange={close}
        title="Promijeni grupu"
        description="Prelazak određuje pedagog. Upis ostaje isti: nema nove upisnine, depozita ni materijala, cijena je ista, izdati računi se ne mijenjaju."
      >
        {dialog.kind === 'group' && (
          <GroupChange
            enrolment={dialog.enrolment}
            dateOfBirth={children.find((c) => c.id === dialog.enrolment.childId)?.dateOfBirth ?? null}
            onDone={async (to, from) => {
              if (!(await run(changeEnrolmentGroup(dialog.enrolment.id, to, from), `Grupa promijenjena u ${PROGRAM_LABEL[to]}.`))) return;
              close();
            }}
          />
        )}
      </FormDialog>
      <PaymentPlanDialog
        // a just-saved enrolment may not be in the reloaded family yet: it is added so the proposal can be computed
        detail={
          dialog.kind === 'plan' && !enrolments.some((e) => e.id === dialog.enrolment.id)
            ? { ...detail.state.data, enrolments: [...enrolments, dialog.enrolment] }
            : detail.state.data
        }
        enrolment={dialog.kind === 'plan' ? dialog.enrolment : null}
        onClose={close}
      />
    </div>
  );
}

/** „Promijeni grupu“ (SPEC registration-validation A9): Toddlers ↔ Preschoolers from a chosen day, age checked. */
function GroupChange({
  enrolment,
  dateOfBirth,
  onDone,
}: {
  enrolment: Enrolment;
  dateOfBirth: string | null;
  onDone: (to: 'TODDLERS' | 'PRESCHOOLERS', from: string) => Promise<void>;
}): React.JSX.Element {
  const to = enrolment.program === 'TODDLERS' ? 'PRESCHOOLERS' : 'TODDLERS';
  const today = new Date().toISOString().slice(0, 10);
  // the earliest day the child's age fits the other group; never before today
  const earliest = groupChangeFrom(enrolment, dateOfBirth) ?? enrolment.startsOn;
  const [from, setFrom] = useState(today < earliest ? earliest : today);
  const [busy, setBusy] = useState(false);
  const problem = enrolmentAgeProblem(to, dateOfBirth, from, 'change');
  return (
    <div className="grid gap-3">
      <p className="text-sm">
        {PROGRAM_LABEL[enrolment.program]} → <strong>{PROGRAM_LABEL[to]}</strong>, školska {enrolment.schoolYear}
      </p>
      <div className="grid gap-1.5">
        <label htmlFor="group-from" className="text-sm font-medium">Od dana</label>
        <Input id="group-from" type="date" className="h-9 w-44" min={earliest} value={from} onChange={(e) => setFrom(e.target.value || today)} />
      </div>
      {problem && <p className="text-sm text-destructive">{problem}</p>}
      <div>
        <Button
          disabled={busy || problem !== null || from < enrolment.startsOn}
          onClick={async () => {
            setBusy(true);
            try {
              await onDone(to, from);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Spremanje…' : `Prebaci u ${PROGRAM_LABEL[to]}`}
        </Button>
      </div>
    </div>
  );
}
