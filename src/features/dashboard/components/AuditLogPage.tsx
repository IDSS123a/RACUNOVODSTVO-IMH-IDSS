import { useCallback, useEffect, useState } from 'react';
import { ErrorBlock, LoadingBlock } from '@/components/feedback';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatDateTime } from '@/lib/format';
import { actionLabel, objectText } from '../audit-labels';
import { listAuditLog, type AuditCategory, type AuditEntry } from '../repository';

const PAGE = 200;
const CATEGORY_LABEL: Readonly<Record<AuditCategory, string>> = {
  INVOICES: 'Računi i uplate',
  FAMILIES: 'Porodice i upisi',
  SYSTEM: 'Postavke i podaci',
};

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * „Dnevnik izmjena“ (BR-30; specs/dashboard-audit): every change, newest first, read-only. Names are resolved from the
 * encrypted database at display time; the log itself holds no personal data (BR-22).
 */
export function AuditLogPage(): React.JSX.Element {
  const [from, setFrom] = useState(isoDaysAgo(30));
  const [to, setTo] = useState(isoDaysAgo(0));
  const [category, setCategory] = useState<AuditCategory | ''>('');
  const [search, setSearch] = useState('');
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [state, setState] = useState<{ status: 'loading' | 'ready' } | { status: 'error'; error: string }>({ status: 'loading' });

  const load = useCallback(
    async (offset: number) => {
      setState({ status: 'loading' });
      const result = await listAuditLog({
        from: from || null,
        to: to || null,
        category: category || null,
        search: search.trim() || null,
        limit: PAGE,
        offset,
      });
      if (!result.success) return setState({ status: 'error', error: result.error });
      setEntries((current) => (offset === 0 ? result.data.entries : [...current, ...result.data.entries]));
      setTotal(result.data.total);
      setState({ status: 'ready' });
    },
    [from, to, category, search],
  );

  // reload from the first page whenever a filter changes (search waits until typing pauses)
  useEffect(() => {
    const timer = setTimeout(() => void load(0), 250);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <div className="grid gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Dnevnik izmjena</h1>
        <p className="text-sm text-muted-foreground">Svaka izmjena u aplikaciji, najnovija prva. Dnevnik se ne može mijenjati ni brisati.</p>
      </header>

      <div className="flex flex-wrap items-end gap-4">
        <div className="grid gap-1.5">
          <label htmlFor="log-from" className="text-sm font-medium">Od</label>
          <Input id="log-from" type="date" className="w-40" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="log-to" className="text-sm font-medium">Do</label>
          <Input id="log-to" type="date" className="w-40" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="log-category" className="text-sm font-medium">Vrsta izmjene</label>
          <select id="log-category" className="h-9 rounded-md border bg-transparent px-2 text-sm" value={category} onChange={(e) => setCategory(e.target.value as AuditCategory | '')}>
            <option value="">Sve</option>
            {(Object.keys(CATEGORY_LABEL) as AuditCategory[]).map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
        </div>
        <div className="grid flex-1 gap-1.5">
          <label htmlFor="log-search" className="text-sm font-medium">Traži</label>
          <Input id="log-search" className="min-w-48" placeholder="broj računa, porodica, dijete, detalj…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {state.status === 'error' && <ErrorBlock message={state.error} onRetry={() => void load(0)} />}
      {state.status === 'loading' && entries.length === 0 && <LoadingBlock />}
      {state.status !== 'error' && (entries.length > 0 || state.status === 'ready') && (
        <>
          <p className="text-sm text-muted-foreground">
            Prikazano {entries.length} od {total} izmjena.
          </p>
          {entries.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Vrijeme</TableHead>
                  <TableHead>Radnja</TableHead>
                  <TableHead>Objekat</TableHead>
                  <TableHead className="hidden md:table-cell">Detalji</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((entry) => (
                  <TableRow key={entry.id}>
                    <TableCell className="tabular-nums">{formatDateTime(entry.at)}</TableCell>
                    <TableCell>{actionLabel(entry.action)}</TableCell>
                    <TableCell>{objectText(entry)}</TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{entry.details}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {entries.length < total && (
            <div>
              <Button variant="outline" disabled={state.status === 'loading'} onClick={() => void load(entries.length)}>
                {state.status === 'loading' ? 'Učitavam…' : 'Učitaj još'}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
