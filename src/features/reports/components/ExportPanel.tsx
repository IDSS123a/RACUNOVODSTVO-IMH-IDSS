import { useState } from 'react';
import { FileSpreadsheetIcon, FileTextIcon, TableIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatKM } from '@/features/billing/money';
import type { LegalEntityCode } from '@/features/price-lists/types';
import { letterheadOf } from '@/features/settings/letterheads';
import { useStepInvoices } from '@/features/workflow/style';
import { formatDate } from '@/lib/format';
import { listAllChildBalances } from '@/features/invoices/repository';
import { buildRegisterCsv, buildRegisterDocx, buildRegisterXlsx, totals } from '../register-export';

const pdfActions = () => import('@/features/invoices/pdf-actions');
const today = (): string => new Date().toISOString().slice(0, 10);

/** First day of the school year that contains today (September). */
function schoolYearStart(date: string): string {
  const year = Number(date.slice(0, 4));
  return Number(date.slice(5, 7)) >= 9 ? `${year}-09-01` : `${year - 1}-09-01`;
}

/**
 * „Izvoz“ in reporting (DEFINICIJA M7, §4 task 3): the invoice register of an institution and period as XLSX, CSV or
 * a DOCX report. Read-only: nothing is created or changed here.
 */
export function ExportPanel({ entity }: { entity: LegalEntityCode }): React.JSX.Element {
  const [from, setFrom] = useState(schoolYearStart(today()));
  const [to, setTo] = useState(today());
  const [busy, setBusy] = useState(false);
  const { invoices, error } = useStepInvoices({ from, to, entity }, 0);
  const t = invoices ? totals(invoices, today()) : null;
  const title = `${entity}, ${formatDate(from)} – ${formatDate(to)}`;
  const base = `Izvjestaj_${entity}_${from}_${to}`;

  async function save(kind: 'xlsx' | 'csv' | 'docx'): Promise<void> {
    if (!invoices) return;
    setBusy(true);
    try {
      const meta = { title, createdOn: today() };
      let balances: Awaited<ReturnType<typeof listAllChildBalances>> | null = null;
      if (kind === 'xlsx') {
        balances = await listAllChildBalances(entity);
        if (!balances.success) return void toast.error(balances.error);
      }
      const bytes = kind === 'xlsx' ? buildRegisterXlsx(invoices, meta, balances?.success ? balances.data : []) : kind === 'csv' ? buildRegisterCsv(invoices) : buildRegisterDocx(invoices, meta, letterheadOf(entity));
      const result = await (await pdfActions()).saveDocument(bytes, `${base}.${kind}`, `${kind.toUpperCase()} izvještaj ${title}`);
      if (!result.success) toast.error(result.error);
      else if (result.data) toast.success(`Sačuvano: ${result.data}`);
      else toast.info('Spremanje otkazano — dokument nije sačuvan.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end gap-4">
        <div className="grid gap-1.5">
          <label htmlFor="exp-from" className="text-sm font-medium">Izdate od</label>
          <Input id="exp-from" type="date" className="w-44" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="exp-to" className="text-sm font-medium">do</label>
          <Input id="exp-to" type="date" className="w-44" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {t && (
        <p className="text-sm">
          {t.count} faktura · fakturisano <strong className="tabular-nums">{formatKM(t.invoiced)}</strong> · naplaćeno <strong className="tabular-nums">{formatKM(t.paid)}</strong> ·
          otvoreno <strong className="tabular-nums">{formatKM(t.open)}</strong>
        </p>
      )}
      <div className="flex flex-wrap gap-3">
        <Button size="lg" disabled={busy || !invoices || invoices.length === 0} onClick={() => void save('xlsx')}>
          <FileSpreadsheetIcon aria-hidden /> Excel (.xlsx)
        </Button>
        <Button size="lg" variant="outline" disabled={busy || !invoices || invoices.length === 0} onClick={() => void save('csv')}>
          <TableIcon aria-hidden /> CSV
        </Button>
        <Button size="lg" variant="outline" disabled={busy || !invoices || invoices.length === 0} onClick={() => void save('docx')}>
          <FileTextIcon aria-hidden /> Izvještaj (.docx)
        </Button>
      </div>
      <p className="text-xs text-muted-foreground">
        Excel sadrži: sažetak, sve fakture (iznos, knjižna odobrenja, za uplatu, uplaćeno, ostatak, status), pregled po mjesecima i otvorene iznose po porodicama.
      </p>
    </div>
  );
}
