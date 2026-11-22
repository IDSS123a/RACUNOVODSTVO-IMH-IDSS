import { useCallback, useMemo, useState } from 'react';
import { FilePlusIcon, FileTextIcon } from 'lucide-react';
import { ErrorBlock, LoadingBlock } from '@/components/feedback';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatKM, type Fenings } from '@/features/billing/money';
import { BALANCE_LABEL, invoiceBalance } from '@/features/invoices/credit-notes';
import { InvoiceDetailDialog } from '@/features/invoices/components/InvoiceDetailDialog';
import { InvoicePdfDialog } from '@/features/invoices/components/InvoicePdfDialog';
import { monthLabel, schoolYearOfMonth } from '@/features/invoices/domain';
import { amountDue } from '@/features/invoices/pdf';
import { listInvoices } from '@/features/invoices/repository';
import type { BillingMonth } from '@/features/invoices/types';
import type { Result } from '@/lib/tauri/invoke';
import { formatDate } from '@/lib/format';
import { useAsyncResult } from '@/lib/use-async-result';
import { listEnrolmentOverview } from '../repository';
import { dashboardStats, type EntityFilter } from '../stats';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function loadData() {
  const month = today().slice(0, 7) as BillingMonth;
  const [invoices, enrolments] = await Promise.all([listInvoices({ entity: null, month: null }), listEnrolmentOverview(schoolYearOfMonth(month))]);
  if (!invoices.success) return invoices;
  if (!enrolments.success) return enrolments;
  return { success: true, data: { invoices: invoices.data, enrolments: enrolments.data } } as const satisfies Result<unknown>;
}

/**
 * „Kontrolni panel“ (BR-29; document `vDash`, specs/dashboard-audit D1–D8): enrolments, unpaid and partly paid
 * invoices, what was invoiced in the month and how it is paid, and the latest invoices — for IMH, IDSS or both.
 */
export function DashboardPage({ onGoToInvoices, initialEntity = 'ALL', compact = false }: { onGoToInvoices?: () => void; initialEntity?: EntityFilter; compact?: boolean }): React.JSX.Element {
  const load = useCallback(() => loadData(), []);
  const data = useAsyncResult(load);
  const [entity, setEntity] = useState<EntityFilter>(initialEntity);
  const [month, setMonth] = useState(today().slice(0, 7));
  const [openId, setOpenId] = useState<string | null>(null);
  const [pdfId, setPdfId] = useState<string | null>(null);

  const stats = useMemo(
    () => (data.state.status === 'ready' ? dashboardStats(data.state.data.invoices, data.state.data.enrolments, { entity, month, today: today() }) : null),
    [data.state, entity, month],
  );

  return (
    <div className="grid gap-6">
      {!compact && (
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Kontrolni panel</h1>
          <p className="text-sm text-muted-foreground">Pregled fakturisanja za IMH i IDSS.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => onGoToInvoices?.()}>
            <FileTextIcon aria-hidden /> Novi račun
          </Button>
          <Button onClick={() => onGoToInvoices?.()}>
            <FilePlusIcon aria-hidden /> Mjesečni računi
          </Button>
        </div>
      </header>
      )}

      <div className="flex flex-wrap items-end gap-4">
        {!compact && (
          <div className="grid gap-1.5">
            <label htmlFor="dash-entity" className="text-sm font-medium">Ustanova</label>
            <select id="dash-entity" className="h-9 rounded-md border bg-transparent px-2 text-sm" value={entity} onChange={(e) => setEntity(e.target.value as EntityFilter)}>
              <option value="ALL">Sve</option>
              <option value="IMH">IMH</option>
              <option value="IDSS">IDSS</option>
            </select>
          </div>
        )}
        <div className="grid gap-1.5">
          <label htmlFor="dash-month" className="text-sm font-medium">Mjesec</label>
          <Input id="dash-month" type="month" className="w-44" value={month} onChange={(e) => setMonth(e.target.value || today().slice(0, 7))} />
        </div>
      </div>

      {data.state.status === 'loading' && <LoadingBlock />}
      {data.state.status === 'error' && <ErrorBlock message={data.state.error} onRetry={data.reload} />}
      {stats && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              title="Aktivni upisi"
              value={String(stats.enrolments.IMH + stats.enrolments.IDSS)}
              sub={`IMH ${stats.enrolments.IMH} · IDSS ${stats.enrolments.IDSS} · ${stats.enrolments.families} porodica`}
            />
            <StatCard
              title="Neplaćeni računi"
              value={String(stats.unpaid.count)}
              tone="danger"
              sub={`Otvoreno ${formatKM(stats.unpaid.open)} · od toga dospjelo ${formatKM(stats.unpaid.overdue)} (${stats.unpaid.overdueCount})`}
            />
            <StatCard
              title="Djelimično plaćeni"
              value={String(stats.partial.count)}
              tone="warning"
              sub={`Uplaćeno ${formatKM(stats.partial.paid)} · ostatak ${formatKM(stats.partial.open)}`}
            />
            <StatCard
              title={`Fakturisano — ${monthLabel(month as BillingMonth)}`}
              value={formatKM(stats.month.invoiced)}
              tone="success"
              sub={`${stats.month.count} računa · ukupno otvoreno svih računa ${formatKM(stats.totalOpen)}`}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Naplata računa izdatih u mjesecu {monthLabel(month as BillingMonth)}</CardTitle>
              <CardDescription>Plaćeno, ostatak djelimično plaćenih i neplaćeno; zbir je fakturisani iznos mjeseca.</CardDescription>
            </CardHeader>
            <CardContent>
              <PaymentBar
                total={stats.month.invoiced}
                segments={[
                  { label: 'Plaćeno', amount: stats.month.paid, count: stats.month.paidCount, className: 'bg-emerald-500' },
                  { label: 'Ostatak djelimično plaćenih', amount: stats.month.partialRest, count: stats.month.partialCount, className: 'bg-amber-500' },
                  { label: 'Neplaćeno', amount: stats.month.unpaid, count: stats.month.unpaidCount, className: 'bg-rose-500' },
                ]}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Zadnje izdati računi</CardTitle>
            </CardHeader>
            <CardContent>
              {stats.recent.length === 0 ? (
                <p className="text-sm text-muted-foreground">Još nema izdatih računa.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Broj</TableHead>
                      <TableHead>Ustanova</TableHead>
                      <TableHead className="hidden sm:table-cell">Datum</TableHead>
                      <TableHead>Dijete</TableHead>
                      <TableHead className="text-right">Iznos</TableHead>
                      <TableHead>Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {stats.recent.map((invoice) => {
                      const status = invoiceBalance(invoice).status;
                      return (
                        <TableRow key={invoice.id} className="cursor-pointer" onClick={() => setOpenId(invoice.id)}>
                          <TableCell className="font-medium">{invoice.number}</TableCell>
                          <TableCell>
                            <Badge className={invoice.entity === 'IMH' ? 'bg-entity-imh-soft text-entity-imh' : 'bg-entity-idss-soft text-entity-idss'}>{invoice.entity}</Badge>
                          </TableCell>
                          <TableCell className="hidden tabular-nums sm:table-cell">{formatDate(invoice.issueDate)}</TableCell>
                          <TableCell>{invoice.childName || invoice.buyerName}</TableCell>
                          <TableCell className="text-right tabular-nums">{formatKM(amountDue(invoice))}</TableCell>
                          <TableCell>
                            <Badge className="whitespace-nowrap" variant={status === 'PAID' ? 'default' : 'outline'}>
                              {invoice.kind === 'CREDIT_NOTE' ? 'Knjižno odobrenje' : BALANCE_LABEL[status]}
                            </Badge>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}

      <InvoiceDetailDialog
        readOnly={compact}
        invoiceId={openId}
        onClose={() => setOpenId(null)}
        onChanged={data.reload}
        onShowPdf={(id) => {
          setOpenId(null);
          setPdfId(id);
        }}
      />
      <InvoicePdfDialog invoiceId={pdfId} onClose={() => setPdfId(null)} />
    </div>
  );
}

function StatCard({ title, value, sub, tone }: { title: string; value: string; sub: string; tone?: 'danger' | 'warning' | 'success' }): React.JSX.Element {
  const color = tone === 'danger' ? 'text-rose-600 dark:text-rose-400' : tone === 'warning' ? 'text-amber-600 dark:text-amber-400' : tone === 'success' ? 'text-emerald-600 dark:text-emerald-400' : '';
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{title}</CardDescription>
        <CardTitle className={`text-2xl tabular-nums ${color}`}>{value}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">{sub}</CardContent>
    </Card>
  );
}

/** One stacked bar, plain DOM (no chart dependency, M-12); each segment's width is its share of the total. */
function PaymentBar({ total, segments }: { total: Fenings; segments: ReadonlyArray<{ label: string; amount: Fenings; count: number; className: string }> }): React.JSX.Element {
  if (total <= 0) return <p className="text-sm text-muted-foreground">U ovom mjesecu nema izdatih računa.</p>;
  return (
    <div className="grid gap-3">
      <div className="flex h-6 w-full overflow-hidden rounded-md bg-muted" role="img" aria-label={segments.map((s) => `${s.label} ${formatKM(s.amount)}`).join(', ')}>
        {segments.map((s) => (s.amount > 0 ? <div key={s.label} className={s.className} style={{ width: `${(s.amount / total) * 100}%` }} /> : null))}
      </div>
      <ul className="grid gap-1 text-sm sm:grid-cols-3">
        {segments.map((s) => (
          <li key={s.label} className="flex items-center gap-2">
            <span className={`size-3 shrink-0 rounded-sm ${s.className}`} aria-hidden />
            <span>
              {s.label}: <strong className="tabular-nums">{formatKM(s.amount)}</strong> ({s.count})
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
