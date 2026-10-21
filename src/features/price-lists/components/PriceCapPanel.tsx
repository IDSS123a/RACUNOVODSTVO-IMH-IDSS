import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatKM, formatPercent } from '@/features/billing/money';
import { Field } from '@/features/settings/components/OperatorForm';
import { saveMinistryApproval, type MinistryApproval } from '@/features/settings/repository';
import { formatDate } from '@/lib/format';
import { MinistryApprovalSchema } from '@/lib/validation/schemas';
import type { PriceCapRow } from '../domain';
import type { PriceCapStatus } from '../price-cap';
import { PROGRAM_LABEL, TIER_LABEL, type SchoolYear } from '../types';

const STATUS: Readonly<Record<PriceCapStatus, { label: string; className: string }>> = {
  WITHIN_CAP: { label: 'U granici', className: 'bg-status-ok/15 text-status-ok' },
  EXCEEDED_WITH_APPROVAL: { label: 'Iznad granice — saglasnost postoji', className: 'bg-status-warn/15 text-status-warn' },
  EXCEEDED: { label: 'Iznad granice — nema saglasnosti', className: 'bg-destructive/15 text-destructive' },
};

/**
 * Price-cap check for IMH (Program 16/26, BR-20) with the ministry approval record (D16).
 */
export function PriceCapPanel({
  schoolYear,
  previousYear,
  rows,
  approval,
  onApprovalSaved,
}: {
  schoolYear: SchoolYear;
  previousYear: SchoolYear;
  rows: ReadonlyArray<PriceCapRow>;
  approval: MinistryApproval | null;
  onApprovalSaved: () => void;
}): React.JSX.Element {
  const form = useForm<MinistryApproval>({
    resolver: zodResolver(MinistryApprovalSchema),
    defaultValues: approval ?? { schoolYear, documentNumber: '', documentDate: '', note: '' },
  });
  const { errors, isSubmitting } = form.formState;

  async function submit(values: MinistryApproval): Promise<void> {
    const result = await saveMinistryApproval({ ...values, schoolYear });
    if (result.success) {
      toast.success('Saglasnost Ministarstva je evidentirana.');
      onApprovalSaved();
    } else toast.error(result.error);
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Provjera povećanja cijena (Program sufinansiranja KS 16/26)</CardTitle>
        <CardDescription>
          Mjesečna školarina domaćih lica, {previousYear} → {schoolYear}. Granica: do 10 % (≤ 400 KM), 5 % (401–600 KM), 3 % (&gt; 600 KM).
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Grupa</TableHead>
              <TableHead>Dijete</TableHead>
              <TableHead className="text-right">{previousYear}</TableHead>
              <TableHead className="text-right">{schoolYear}</TableHead>
              <TableHead className="text-right">Povećanje</TableHead>
              <TableHead className="text-right">Najviše bez saglasnosti</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((row) => (
              <TableRow key={`${row.program}-${row.tier}`}>
                <TableCell className="font-medium">{PROGRAM_LABEL[row.program]}</TableCell>
                <TableCell>{TIER_LABEL[row.tier]}</TableCell>
                <TableCell className="text-right tabular-nums">{formatKM(row.previous)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatKM(row.next)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatPercent(row.increaseBp)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatKM(row.maxAllowed)}</TableCell>
                <TableCell>
                  <Badge className={STATUS[row.status].className}>{STATUS[row.status].label}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <form className="grid gap-4 md:grid-cols-[1fr_12rem_1fr_auto] md:items-end" onSubmit={form.handleSubmit(submit)} noValidate>
          <Field id="approval-number" label="Saglasnost Ministarstva — broj akta" error={errors.documentNumber?.message}>
            <Input id="approval-number" {...form.register('documentNumber')} aria-invalid={Boolean(errors.documentNumber)} />
          </Field>
          <Field id="approval-date" label="Datum akta" error={errors.documentDate?.message}>
            <Input id="approval-date" type="date" {...form.register('documentDate')} aria-invalid={Boolean(errors.documentDate)} />
          </Field>
          <Field id="approval-note" label="Napomena">
            <Input id="approval-note" {...form.register('note')} />
          </Field>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? 'Spremanje…' : approval ? 'Ažuriraj' : 'Evidentiraj saglasnost'}
          </Button>
        </form>
        {approval && (
          <p className="text-sm text-muted-foreground">
            Evidentirano: akt br. {approval.documentNumber} od {formatDate(approval.documentDate)}.
          </p>
        )}
      </CardContent>
    </Card>
  );
}
