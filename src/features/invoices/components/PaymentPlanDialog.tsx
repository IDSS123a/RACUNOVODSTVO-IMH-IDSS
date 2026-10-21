import { useCallback, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { ErrorBlock, LoadingBlock } from '@/components/feedback';
import { FormDialog } from '@/components/form-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatKM } from '@/features/billing/money';
import { PricingError } from '@/features/billing/pricing';
import type { Enrolment, FamilyDetail } from '@/features/families/types';
import { listPriceItems } from '@/features/price-lists/repository';
import { ITEM_LABEL, PROGRAM_LABEL, type PriceListItem, type SchoolYear } from '@/features/price-lists/types';
import { Field } from '@/features/settings/components/OperatorForm';
import { formatDate } from '@/lib/format';
import { useAsyncResult } from '@/lib/use-async-result';
import { InvoiceError } from '../domain';
import { MAX_INSTALMENTS, proposeIdssPlan, type PaymentPlan, type PlanItemCode } from '../plans';
import { listPaymentPlans, savePaymentPlan } from '../repository';

const PLAN_ITEMS: ReadonlyArray<PlanItemCode> = ['TUITION', 'EXTENDED_STAY'];

/** IDSS payment plan of one enrolment (BR-11): current plans and an editor that proposes the instalments. */
export function PaymentPlanDialog({
  detail,
  enrolment,
  onClose,
}: {
  detail: FamilyDetail;
  enrolment: Enrolment | null;
  onClose: () => void;
}): React.JSX.Element {
  const child = enrolment ? detail.children.find((c) => c.id === enrolment.childId) : undefined;
  return (
    <FormDialog
      open={enrolment !== null}
      onOpenChange={(open) => !open && onClose()}
      title={`Plan plaćanja${child ? ` — ${child.firstName} ${child.lastName}` : ''}`}
      description={enrolment ? `${PROGRAM_LABEL[enrolment.program]}, ${enrolment.schoolYear}. Svaka rata dospijeva 5. u mjesecu; iznosi su po cjenovniku.` : undefined}
      wide
    >
      {enrolment && <PlanBody detail={detail} enrolment={enrolment} />}
    </FormDialog>
  );
}

function PlanBody({ detail, enrolment }: { detail: FamilyDetail; enrolment: Enrolment }): React.JSX.Element {
  const schoolYear = enrolment.schoolYear as SchoolYear;
  const loadPrices = useCallback(() => listPriceItems(schoolYear), [schoolYear]);
  const loadPlans = useCallback(() => listPaymentPlans(schoolYear), [schoolYear]);
  const prices = useAsyncResult(loadPrices);
  const plans = useAsyncResult(loadPlans);

  if (prices.state.status === 'loading' || plans.state.status === 'loading') return <LoadingBlock />;
  if (prices.state.status === 'error') return <ErrorBlock message={prices.state.error} onRetry={prices.reload} />;
  if (plans.state.status === 'error') return <ErrorBlock message={plans.state.error} onRetry={plans.reload} />;
  const own = plans.state.data.filter((p) => p.enrolmentId === enrolment.id);
  return <PlanEditor detail={detail} enrolment={enrolment} priceItems={prices.state.data} plans={own} onSaved={plans.reload} />;
}

function PlanEditor({
  detail,
  enrolment,
  priceItems,
  plans,
  onSaved,
}: {
  detail: FamilyDetail;
  enrolment: Enrolment;
  priceItems: ReadonlyArray<PriceListItem>;
  plans: ReadonlyArray<PaymentPlan>;
  onSaved: () => void;
}): React.JSX.Element {
  const [itemCode, setItemCode] = useState<PlanItemCode>('TUITION');
  const [count, setCount] = useState<string>(String(plans.find((p) => p.itemCode === 'TUITION')?.instalments ?? 10));
  const [saving, setSaving] = useState(false);
  const existing = plans.find((p) => p.itemCode === itemCode);
  const locked = existing?.items.some((i) => i.invoiceId !== null) ?? false;

  const proposal = useMemo(() => {
    try {
      return { ok: true as const, value: proposeIdssPlan(detail, priceItems, enrolment.id, itemCode, Number(count)) };
    } catch (error: unknown) {
      if (error instanceof InvoiceError || error instanceof PricingError) return { ok: false as const, error: error.message };
      throw error;
    }
  }, [detail, priceItems, enrolment.id, itemCode, count]);

  async function save(): Promise<void> {
    if (!proposal.ok) return;
    setSaving(true);
    try {
      const result = await savePaymentPlan({
        id: crypto.randomUUID(),
        enrolmentId: enrolment.id,
        childId: enrolment.childId,
        itemCode,
        instalments: proposal.value.items.length,
        total: proposal.value.total,
        items: proposal.value.items.map((i) => ({ ...i, invoiceId: null })),
      });
      if (result.success) {
        toast.success(`Plan je sačuvan: ${ITEM_LABEL[itemCode].toLowerCase()}, ${proposal.value.items.length} rata.`);
        onSaved();
      } else toast.error(result.error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-5">
      <div className="grid gap-2 text-sm">
        {PLAN_ITEMS.map((code) => {
          const plan = plans.find((p) => p.itemCode === code);
          const invoiced = plan?.items.filter((i) => i.invoiceId !== null).length ?? 0;
          return (
            <p key={code}>
              <span className="font-medium">{ITEM_LABEL[code]}:</span>{' '}
              {plan ? (
                <>
                  {formatKM(plan.total)} u {plan.instalments} rata · fakturisano {invoiced}/{plan.instalments}
                </>
              ) : (
                <span className="text-muted-foreground">nema plana</span>
              )}
            </p>
          );
        })}
      </div>

      <div className="flex flex-wrap items-end gap-4 rounded-lg border p-4">
        <Field id="plan-item" label="Stavka">
          <Select
            value={itemCode}
            onValueChange={(value) => {
              const code = value as PlanItemCode;
              setItemCode(code);
              setCount(String(plans.find((p) => p.itemCode === code)?.instalments ?? MAX_INSTALMENTS[code]));
            }}
          >
            <SelectTrigger id="plan-item" className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PLAN_ITEMS.map((code) => (
                <SelectItem key={code} value={code}>
                  {ITEM_LABEL[code]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field id="plan-count" label={`Broj rata (1–${MAX_INSTALMENTS[itemCode]})`}>
          <Input id="plan-count" type="number" min={1} max={MAX_INSTALMENTS[itemCode]} className="w-28" value={count} onChange={(e) => setCount(e.target.value)} />
        </Field>
        <Button disabled={!proposal.ok || saving || locked} onClick={() => void save()}>
          {saving ? 'Spremanje…' : existing ? 'Zamijeni plan' : 'Sačuvaj plan'}
        </Button>
        {locked && <Badge variant="outline">Plan ima fakturisane rate i ne može se mijenjati</Badge>}
      </div>

      {!proposal.ok && (
        <Alert variant="destructive">
          <AlertDescription>{proposal.error}</AlertDescription>
        </Alert>
      )}
      {proposal.ok && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Rata</TableHead>
              <TableHead>Rok</TableHead>
              <TableHead className="text-right">Iznos</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {proposal.value.items.map((item) => (
              <TableRow key={item.sequence}>
                <TableCell>{item.sequence}.</TableCell>
                <TableCell>{formatDate(item.dueDate)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatKM(item.amount)}</TableCell>
              </TableRow>
            ))}
            <TableRow>
              <TableCell colSpan={2} className="font-medium">Ukupno</TableCell>
              <TableCell className="text-right font-semibold tabular-nums">{formatKM(proposal.value.total)}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )}
    </div>
  );
}
