import { useCallback, useMemo, useState } from 'react';
import { ArrowLeftIcon, CalendarRangeIcon, PencilIcon, PlusIcon, ReceiptIcon, Trash2Icon } from 'lucide-react';
import { toast } from 'sonner';
import { ErrorBlock, LoadingBlock } from '@/components/feedback';
import { FormDialog } from '@/components/form-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { EnrolmentFeeDialog } from '@/features/invoices/components/EnrolmentFeeDialog';
import { PaymentPlanDialog } from '@/features/invoices/components/PaymentPlanDialog';
import { listPriceItems, listSchoolYears } from '@/features/price-lists/repository';
import { PROGRAM_ENTITY, PROGRAM_LABEL, type SchoolYear } from '@/features/price-lists/types';
import { formatDate } from '@/lib/format';
import { useAsyncResult } from '@/lib/use-async-result';
import { changeEnrolmentStatus, saveFamilyWithGuardians, saveValidatedEnrolment } from '../actions';
import { allowedTransitions, buildFamilyPricing } from '../domain';
import { deleteChild, deleteEnrolment, deleteFamily, getFamily, saveChild } from '../repository';
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
  | { kind: 'fees'; enrolment: Enrolment };

/** One family: guardians, children, enrolments, and who pays the full / discounted price. */
export function FamilyDetailView({
  familyId,
  defaultYear,
  onBack,
}: {
  familyId: string;
  defaultYear: SchoolYear;
  onBack: () => void;
}): React.JSX.Element {
  const loadFamily = useCallback(() => getFamily(familyId), [familyId]);
  const loadYears = useCallback(() => listSchoolYears(), []);
  const loadPrices = useCallback(() => listPriceItems(), []);
  const detail = useAsyncResult(loadFamily);
  const years = useAsyncResult(loadYears);
  const prices = useAsyncResult(loadPrices);
  const [year, setYear] = useState<SchoolYear>(defaultYear);
  const [dialog, setDialog] = useState<DialogState>({ kind: 'none' });

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

  async function removeFamily(): Promise<void> {
    if (await run(deleteFamily(family.id), 'Porodica je obrisana.')) onBack();
  }

  return (
    <div className="grid gap-6">
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
          <Button variant="ghost" disabled={children.length > 0} title={children.length > 0 ? 'Prvo obrišite djecu' : undefined} onClick={() => void removeFamily()}>
            <Trash2Icon aria-hidden /> Obriši
          </Button>
        </div>
      </header>

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
                    </p>
                    <p className="text-xs text-muted-foreground">
                      rođen/a {formatDate(child.dateOfBirth)} · {child.residency === 'DOMESTIC' ? 'domaće lice' : 'strano lice'}
                      {!child.citizenBih || !child.residenceKs ? ' · nema uslove za subvenciju' : ''}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'enrolment', enrolment: newEnrolment(child.id, year) })}>
                      <PlusIcon aria-hidden /> Upis
                    </Button>
                    <Button size="sm" variant="ghost" aria-label="Uredi dijete" onClick={() => setDialog({ kind: 'child', child })}>
                      <PencilIcon aria-hidden />
                    </Button>
                    <Button size="sm" variant="ghost" aria-label="Obriši dijete" disabled={own.length > 0} onClick={() => void run(deleteChild(child.id), 'Dijete je obrisano.')}>
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
                    <div className="ml-auto flex flex-wrap gap-1">
                      {(enrolment.status === 'AWAITING_ENROLMENT_PAYMENT' || enrolment.status === 'ACTIVE') && (
                        <Button size="sm" variant="outline" onClick={() => setDialog({ kind: 'fees', enrolment })}>
                          <ReceiptIcon aria-hidden /> Račun za upis
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
                      {enrolment.status === 'AWAITING_ENROLMENT_PAYMENT' && (
                        <Button size="sm" variant="ghost" aria-label="Obriši upis" onClick={() => void run(deleteEnrolment(enrolment.id), 'Upis je obrisan.')}>
                          <Trash2Icon aria-hidden />
                        </Button>
                      )}
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
            if (await run(saveFamilyWithGuardians(f, g), 'Porodica je sačuvana.')) close();
          }}
        />
      </FormDialog>
      <FormDialog open={dialog.kind === 'child'} onOpenChange={close} title="Dijete">
        {dialog.kind === 'child' && (
          <ChildForm
            child={dialog.child}
            onSubmit={async (child) => {
              if (await run(saveChild(child), 'Dijete je sačuvano.')) close();
            }}
          />
        )}
      </FormDialog>
      <FormDialog open={dialog.kind === 'enrolment'} onOpenChange={close} title="Novi upis" description="Program određuje ustanovu. Novi upis čeka uplatu upisnih troškova.">
        {dialog.kind === 'enrolment' && (
          <EnrolmentForm
            enrolment={dialog.enrolment}
            schoolYears={schoolYears}
            onSubmit={async (enrolment) => {
              const others = enrolments.filter((e) => e.childId === enrolment.childId);
              if (await run(saveValidatedEnrolment(enrolment, others), 'Dijete je upisano.')) close();
            }}
          />
        )}
      </FormDialog>
      <PaymentPlanDialog detail={detail.state.data} enrolment={dialog.kind === 'plan' ? dialog.enrolment : null} onClose={close} />
      <EnrolmentFeeDialog detail={detail.state.data} enrolment={dialog.kind === 'fees' ? dialog.enrolment : null} onClose={close} />
    </div>
  );
}
