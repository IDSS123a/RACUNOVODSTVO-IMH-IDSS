import { useCallback, useMemo, useState } from 'react';
import { FilePlusIcon, FileTextIcon, SearchIcon, SendIcon } from 'lucide-react';
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
import { BALANCE_LABEL, invoiceBalance } from '../credit-notes';
import { listInvoices } from '../repository';
import { searchInvoices, STATUS_FILTER_LABEL, type StatusFilter } from '../search';
import { InvoiceDetailDialog } from './InvoiceDetailDialog';
import { InvoicePdfDialog } from './InvoicePdfDialog';
import { NewInvoiceDialog } from './NewInvoiceDialog';
import { ExportDialog, type ExportRequest } from './ExportDialog';

function currentMonthRange(): ExportRequest {
  const now = new Date();
  const first = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  const last = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}
import { IssueMonthDialog } from './IssueMonthDialog';

type EntityFilter = LegalEntityCode | 'ALL';

/** Invoice register with filters, totals and the monthly billing action (IMH and IDSS). */
export function InvoicesPage({ initialEntity = 'ALL', readOnly = false }: { initialEntity?: EntityFilter; readOnly?: boolean } = {}): React.JSX.Element {
  const [entity, setEntity] = useState<EntityFilter>(initialEntity);
  const [month, setMonth] = useState<string>('');
  const [issuing, setIssuing] = useState(false);
  const [manual, setManual] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [pdfId, setPdfId] = useState<string | null>(null);
  const [exportRequest, setExportRequest] = useState<ExportRequest | null>(null);
  const load = useCallback(() => listInvoices({ entity: entity === 'ALL' ? null : entity, month: month || null }), [entity, month]);
  const invoices = useAsyncResult(load);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<StatusFilter>('ALL');

  // search and status filter run on the loaded register (Director, 2026-11-21: no scrolling to find an invoice)
  const visible = useMemo(
    () => (invoices.state.status === 'ready' ? searchInvoices(invoices.state.data, query, status, new Date().toISOString().slice(0, 10)) : []),
    [invoices.state, query, status],
  );

  const totals = useMemo(() => {
    if (invoices.state.status !== 'ready') return null;
    // Credit notes are documents, not debts; their effect is already in the net of the invoice they cancel.
    const rows = visible.filter((i) => i.status === 'ISSUED' && i.kind !== 'CREDIT_NOTE');
    return {
      total: sum(rows.map((i) => invoiceBalance(i).net)),
      open: sum(rows.map((i) => invoiceBalance(i).open)),
    };
  }, [invoices.state, visible]);

  return (
    <div className="grid gap-6">
      {!readOnly && (
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Računi</h1>
          <p className="text-sm text-muted-foreground">Izdati računi IMH i IDSS, uplate i otvoreni iznosi.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setExportRequest(currentMonthRange())}>
            <SendIcon aria-hidden /> Izvoz i slanje
          </Button>
          <Button variant="outline" onClick={() => setManual(true)}>
            <FileTextIcon aria-hidden /> Novi račun
          </Button>
          <Button onClick={() => setIssuing(true)}>
            <FilePlusIcon aria-hidden /> Mjesečni računi
          </Button>
        </div>
      </header>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <div className="grid min-w-64 flex-1 gap-1.5">
          <label htmlFor="filter-search" className="text-sm font-medium">Traži</label>
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
            <Input
              id="filter-search"
              className="pl-8"
              placeholder="broj (npr. 12/26), dijete, kupac ili porodica…"
              value={query}
              autoFocus
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="filter-status" className="text-sm font-medium">Status</label>
          <select id="filter-status" className="h-9 rounded-md border bg-transparent px-2 text-sm" value={status} onChange={(e) => setStatus(e.target.value as StatusFilter)}>
            {(Object.keys(STATUS_FILTER_LABEL) as StatusFilter[]).map((s) => (
              <option key={s} value={s}>
                {STATUS_FILTER_LABEL[s]}
              </option>
            ))}
          </select>
        </div>
        {!readOnly && (
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
        )}
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
            Prikazano <strong className="tabular-nums">{visible.length}</strong>
            {invoices.state.status === 'ready' && ` od ${invoices.state.data.length}`} · Fakturisano: <strong className="tabular-nums">{formatKM(totals.total)}</strong> · Otvoreno:{' '}
            <strong className="tabular-nums text-destructive">{formatKM(totals.open)}</strong>
          </p>
        )}
      </div>

      {invoices.state.status === 'loading' && <LoadingBlock />}
      {invoices.state.status === 'error' && <ErrorBlock message={invoices.state.error} onRetry={invoices.reload} />}
      {invoices.state.status === 'ready' && visible.length === 0 && <EmptyBlock message="Nema računa za odabrane filtere i pretragu." />}
      {invoices.state.status === 'ready' && visible.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Broj</TableHead>
              <TableHead>Dijete</TableHead>
              <TableHead className="hidden md:table-cell">Kupac</TableHead>
              <TableHead>Izdat</TableHead>
              <TableHead className="hidden lg:table-cell">Rok</TableHead>
              <TableHead className="text-right">Iznos</TableHead>
              <TableHead className="hidden text-right sm:table-cell">Uplaćeno</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((invoice) => {
              const status = invoiceBalance(invoice).status;
              const label = invoice.kind === 'CREDIT_NOTE' ? 'Knjižno odobrenje' : BALANCE_LABEL[status];
              return (
                <TableRow key={invoice.id} className="cursor-pointer" onClick={() => setOpenId(invoice.id)}>
                  <TableCell className="font-medium">
                    <button type="button" className="hover:underline" onClick={() => setOpenId(invoice.id)}>
                      {invoice.number}
                    </button>
                    {invoice.source === 'LEGACY' && (
                      <Badge variant="outline" className="ml-2" title="Uvezeno iz starog rješenja (Excel)">
                        uvezen
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{invoice.childName}</TableCell>
                  <TableCell className="hidden md:table-cell">{invoice.buyerName}</TableCell>
                  <TableCell className="tabular-nums">{formatDate(invoice.issueDate)}</TableCell>
                  <TableCell className="hidden tabular-nums lg:table-cell">{formatDate(invoice.dueDate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatKM(invoice.total)}</TableCell>
                  <TableCell className="hidden text-right tabular-nums sm:table-cell">{formatKM(invoice.paid)}</TableCell>
                  <TableCell>
                    <Badge className="whitespace-nowrap" variant={status === 'PAID' ? 'default' : status === 'CANCELLED' ? 'secondary' : 'outline'}>{label}</Badge>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      )}

      <IssueMonthDialog
        open={issuing}
        onOpenChange={setIssuing}
        onIssued={(issueDate) => {
          invoices.reload();
          setExportRequest({ from: issueDate, to: issueDate });
        }}
      />
      <NewInvoiceDialog open={manual} onOpenChange={setManual} onCreated={invoices.reload} />
      <ExportDialog request={exportRequest} onClose={() => setExportRequest(null)} />
      <InvoiceDetailDialog invoiceId={openId} readOnly={readOnly} onClose={() => setOpenId(null)} onChanged={invoices.reload} onShowPdf={(id) => { setOpenId(null); setPdfId(id); }} />
      <InvoicePdfDialog invoiceId={pdfId} onClose={() => setPdfId(null)} />
    </div>
  );
}
