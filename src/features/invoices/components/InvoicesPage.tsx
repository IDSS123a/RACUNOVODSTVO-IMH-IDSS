import { useCallback, useMemo, useState } from 'react';
import { FilePlusIcon } from 'lucide-react';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/feedback';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatKM, sum } from '@/features/billing/money';
import type { LegalEntityCode } from '@/features/price-lists/types';
import { formatDate } from '@/lib/format';
import { useAsyncResult } from '@/lib/use-async-result';
import { summarisePayments } from '../domain';
import { listInvoices } from '../repository';
import { PAYMENT_STATUS_LABEL } from '../types';
import { InvoiceDetailDialog } from './InvoiceDetailDialog';
import { IssueMonthDialog } from './IssueMonthDialog';

type EntityFilter = LegalEntityCode | 'ALL';

/** Invoice register with filters, totals and the monthly IMH billing action. */
export function InvoicesPage(): React.JSX.Element {
  const [entity, setEntity] = useState<EntityFilter>('ALL');
  const [month, setMonth] = useState<string>('');
  const [issuing, setIssuing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const load = useCallback(() => listInvoices({ entity: entity === 'ALL' ? null : entity, month: month || null }), [entity, month]);
  const invoices = useAsyncResult(load);

  const totals = useMemo(() => {
    if (invoices.state.status !== 'ready') return null;
    const rows = invoices.state.data.filter((i) => i.status === 'ISSUED');
    return {
      total: sum(rows.map((i) => i.total)),
      open: sum(rows.map((i) => summarisePayments(i.total, [i.paid]).open)),
    };
  }, [invoices.state]);

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Računi</h1>
          <p className="text-sm text-muted-foreground">Izdati računi IMH i IDSS, uplate i otvoreni iznosi.</p>
        </div>
        <Button onClick={() => setIssuing(true)}>
          <FilePlusIcon aria-hidden /> Mjesečni računi IMH
        </Button>
      </header>

      <div className="flex flex-wrap items-end gap-4">
        <div className="grid gap-1.5">
          <label htmlFor="filter-entity" className="text-sm font-medium">Ustanova</label>
          <Select value={entity} onValueChange={(value) => setEntity(value as EntityFilter)}>
            <SelectTrigger id="filter-entity" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="ALL">Sve</SelectItem>
              <SelectItem value="IMH">IMH</SelectItem>
              <SelectItem value="IDSS">IDSS</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="filter-month" className="text-sm font-medium">Mjesec</label>
          <Input id="filter-month" type="month" className="w-44" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
        {month && (
          <Button variant="ghost" onClick={() => setMonth('')}>
            Svi mjeseci
          </Button>
        )}
        {totals && (
          <p className="ml-auto text-sm">
            Fakturisano: <strong className="tabular-nums">{formatKM(totals.total)}</strong> · Otvoreno:{' '}
            <strong className="tabular-nums text-destructive">{formatKM(totals.open)}</strong>
          </p>
        )}
      </div>

      {invoices.state.status === 'loading' && <LoadingBlock />}
      {invoices.state.status === 'error' && <ErrorBlock message={invoices.state.error} onRetry={invoices.reload} />}
      {invoices.state.status === 'ready' && invoices.state.data.length === 0 && <EmptyBlock message="Nema računa za odabrane filtere." />}
      {invoices.state.status === 'ready' && invoices.state.data.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Broj</TableHead>
              <TableHead>Kupac</TableHead>
              <TableHead>Porodica</TableHead>
              <TableHead>Izdat</TableHead>
              <TableHead>Rok</TableHead>
              <TableHead className="text-right">Iznos</TableHead>
              <TableHead className="text-right">Uplaćeno</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {invoices.state.data.map((invoice) => {
              const status = summarisePayments(invoice.total, [invoice.paid]).status;
              return (
                <TableRow key={invoice.id} className="cursor-pointer" onClick={() => setOpenId(invoice.id)}>
                  <TableCell className="font-medium">
                    <button type="button" className="hover:underline" onClick={() => setOpenId(invoice.id)}>
                      {invoice.number}
                    </button>
                  </TableCell>
                  <TableCell>{invoice.buyerName}</TableCell>
                  <TableCell>{invoice.familyName}</TableCell>
                  <TableCell>{formatDate(invoice.issueDate)}</TableCell>
                  <TableCell>{formatDate(invoice.dueDate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatKM(invoice.total)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatKM(invoice.paid)}</TableCell>
                  <TableCell>
                    <Badge variant={status === 'PAID' ? 'default' : 'outline'}>{PAYMENT_STATUS_LABEL[status]}</Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <IssueMonthDialog open={issuing} onOpenChange={setIssuing} onIssued={invoices.reload} />
      <InvoiceDetailDialog invoiceId={openId} onClose={() => setOpenId(null)} onChanged={invoices.reload} />
    </div>
  );
}
