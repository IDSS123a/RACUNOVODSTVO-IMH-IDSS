import { useCallback, useMemo, useState } from 'react';
import { FileTextIcon } from 'lucide-react';
import { toast } from 'sonner';
import { ErrorBlock, LoadingBlock } from '@/components/feedback';
import { FormDialog } from '@/components/form-dialog';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatKM } from '@/features/billing/money';
import { PricingError } from '@/features/billing/pricing';
import type { Enrolment, FamilyDetail } from '@/features/families/types';
import { listPriceItems } from '@/features/price-lists/repository';
import { PROGRAM_ENTITY, PROGRAM_LABEL, type PriceListItem, type SchoolYear } from '@/features/price-lists/types';
import { Field } from '@/features/settings/components/OperatorForm';
import { formatDate } from '@/lib/format';
import { useAsyncResult } from '@/lib/use-async-result';
import { InvoiceError } from '../domain';
import { buildEnrolmentFeeInvoice } from '../enrolment-fees';
import type { PaymentPlan } from '../plans';
import { issueInvoices, listPaymentPlans } from '../repository';
import { InvoicePdfDialog } from './InvoicePdfDialog';

/** Enrolment-fee invoice for one enrolment (BR-9, BR-10): preview, approve, then PDF. */
export function EnrolmentFeeDialog({
  detail,
  enrolment,
  onClose,
}: {
  detail: FamilyDetail;
  enrolment: Enrolment | null;
  onClose: () => void;
}): React.JSX.Element {
  const [createdId, setCreatedId] = useState<string | null>(null);
  const child = enrolment ? detail.children.find((c) => c.id === enrolment.childId) : undefined;
  return (
    <>
      <FormDialog
        open={enrolment !== null}
        onOpenChange={(open) => !open && onClose()}
        title={`Račun za upis${child ? ` — ${child.firstName} ${child.lastName}` : ''}`}
        description={enrolment ? `${PROGRAM_LABEL[enrolment.program]} (${PROGRAM_ENTITY[enrolment.program]}), ${enrolment.schoolYear}. Iznosi su po cjenovniku; račun se kreira tek kad ga odobrite.` : undefined}
        wide
      >
        {enrolment && (
          <FeeBody
            detail={detail}
            enrolment={enrolment}
            onCreated={(invoiceId) => {
              onClose();
              setCreatedId(invoiceId);
            }}
          />
        )}
      </FormDialog>
      <InvoicePdfDialog invoiceId={createdId} onClose={() => setCreatedId(null)} />
    </>
  );
}

function FeeBody({ detail, enrolment, onCreated }: { detail: FamilyDetail; enrolment: Enrolment; onCreated: (invoiceId: string) => void }): React.JSX.Element {
  const schoolYear = enrolment.schoolYear as SchoolYear;
  const loadPrices = useCallback(() => listPriceItems(schoolYear), [schoolYear]);
  const loadPlans = useCallback(() => listPaymentPlans(schoolYear), [schoolYear]);
  const prices = useAsyncResult(loadPrices);
  const plans = useAsyncResult(loadPlans);
  if (prices.state.status === 'loading' || plans.state.status === 'loading') return <LoadingBlock />;
  if (prices.state.status === 'error') return <ErrorBlock message={prices.state.error} onRetry={prices.reload} />;
  if (plans.state.status === 'error') return <ErrorBlock message={plans.state.error} onRetry={plans.reload} />;
  return <FeePreview detail={detail} enrolment={enrolment} priceItems={prices.state.data} plans={plans.state.data} onCreated={onCreated} />;
}

function FeePreview({
  detail,
  enrolment,
  priceItems,
  plans,
  onCreated,
}: {
  detail: FamilyDetail;
  enrolment: Enrolment;
  priceItems: ReadonlyArray<PriceListItem>;
  plans: ReadonlyArray<PaymentPlan>;
  onCreated: (invoiceId: string) => void;
}): React.JSX.Element {
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));
  const [idssDeposit, setIdssDeposit] = useState(false);
  const [busy, setBusy] = useState(false);
  const isIdss = PROGRAM_ENTITY[enrolment.program] === 'IDSS';

  const proposal = useMemo(() => {
    try {
      return { ok: true as const, value: buildEnrolmentFeeInvoice(detail, priceItems, plans, enrolment.id, { idssDeposit }, issueDate) };
    } catch (error: unknown) {
      if (error instanceof InvoiceError || error instanceof PricingError) return { ok: false as const, error: error.message };
      throw error;
    }
  }, [detail, priceItems, plans, enrolment.id, idssDeposit, issueDate]);

  async function create(): Promise<void> {
    if (!proposal.ok) return;
    setBusy(true);
    try {
      const id = crypto.randomUUID();
      const { draft } = proposal.value;
      const result = await issueInvoices([{ ...draft, id, kind: 'ENROLMENT_FEES', lines: [...draft.lines], planItems: [] }]);
      if (result.success) {
        toast.success(`Kreiran račun ${result.data[0] ?? ''}.`);
        onCreated(id);
      } else toast.error(result.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <Field id="fee-issue-date" label="Datum izdavanja">
          <Input id="fee-issue-date" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
        </Field>
        {isIdss && (
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input type="checkbox" className="size-4" checked={idssDeposit} onChange={(e) => setIdssDeposit(e.target.checked)} />
            Depozit (odluka škole, samo uz plaćanje školarine na rate)
          </label>
        )}
      </div>

      {!proposal.ok && (
        <Alert variant="destructive">
          <AlertDescription>{proposal.error}</AlertDescription>
        </Alert>
      )}
      {proposal.ok && (
        <>
          {proposal.value.notes.map((note) => (
            <p key={note} className="text-sm text-muted-foreground">
              {note}
            </p>
          ))}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Stavka</TableHead>
                <TableHead className="text-right">Iznos</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {proposal.value.draft.lines.map((line) => (
                <TableRow key={line.itemCode}>
                  <TableCell>{line.description}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatKM(line.amount)}</TableCell>
                </TableRow>
              ))}
              <TableRow>
                <TableCell className="font-medium">
                  Ukupno · kupac {proposal.value.draft.buyerName} · rok {formatDate(proposal.value.draft.dueDate)}
                </TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{formatKM(proposal.value.draft.total)}</TableCell>
              </TableRow>
            </TableBody>
          </Table>
        </>
      )}
      <div>
        <Button disabled={!proposal.ok || busy} onClick={() => void create()}>
          <FileTextIcon aria-hidden /> {busy ? 'Kreiram…' : 'Odobri i kreiraj račun'}
        </Button>
      </div>
    </div>
  );
}
