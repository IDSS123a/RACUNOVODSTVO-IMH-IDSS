import { useCallback, useMemo, useState } from 'react';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/feedback';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { listMinistryApprovals } from '@/features/settings/repository';
import { useAsyncResult } from '@/lib/use-async-result';
import { buildPriceCapRows, buildPriceTable, previousSchoolYear } from '../domain';
import { listPriceItems, listSchoolYears } from '../repository';
import { PROGRAM_LABEL, type LegalEntityCode, type SchoolYear } from '../types';
import { PriceCapPanel } from './PriceCapPanel';
import { PriceTable } from './PriceTable';

const ENTITY_LABEL: Readonly<Record<LegalEntityCode, string>> = {
  IMH: 'IMH — vrtić (Toddlers, Preschoolers, IDSS Preschoolers)',
  IDSS: 'IDSS — osnovna škola (I–IX)',
};

/** Official price lists per school year and legal entity, plus the IMH price-cap check. */
export function PriceListPage({ initialYear }: { initialYear: SchoolYear }): React.JSX.Element {
  const [year, setYear] = useState<SchoolYear>(initialYear);
  const loadYears = useCallback(() => listSchoolYears(), []);
  const loadItems = useCallback(() => listPriceItems(), []);
  const loadApprovals = useCallback(() => listMinistryApprovals(), []);
  const years = useAsyncResult(loadYears);
  const items = useAsyncResult(loadItems);
  const approvals = useAsyncResult(loadApprovals);

  const approval = approvals.state.status === 'ready' ? approvals.state.data.find((a) => a.schoolYear === year) ?? null : null;
  const view = useMemo(() => {
    if (items.state.status !== 'ready') return null;
    return {
      IMH: buildPriceTable(items.state.data, year, 'IMH'),
      IDSS: buildPriceTable(items.state.data, year, 'IDSS'),
      cap: buildPriceCapRows(items.state.data, year, approval !== null),
    };
  }, [items.state, year, approval]);

  if (items.state.status === 'loading' || years.state.status === 'loading') return <LoadingBlock />;
  if (items.state.status === 'error') return <ErrorBlock message={items.state.error} onRetry={items.reload} />;
  if (years.state.status === 'error') return <ErrorBlock message={years.state.error} onRetry={years.reload} />;
  if (!view) return <LoadingBlock />;

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Cjenovnik</h1>
          <p className="text-sm text-muted-foreground">Zvanični cjenovnici. Svaki iznos navodi dokument iz kojeg je preuzet (ikona i).</p>
        </div>
        <div className="grid gap-1.5">
          <label htmlFor="school-year" className="text-sm font-medium">
            Školska godina
          </label>
          <Select value={year} onValueChange={(value) => setYear(value as SchoolYear)}>
            <SelectTrigger id="school-year" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {years.state.data.map((schoolYear) => (
                <SelectItem key={schoolYear} value={schoolYear}>
                  {schoolYear}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>

      <Tabs defaultValue="IMH">
        <TabsList>
          <TabsTrigger value="IMH">IMH</TabsTrigger>
          <TabsTrigger value="IDSS">IDSS</TabsTrigger>
        </TabsList>
        {(['IMH', 'IDSS'] as const).map((entity) => (
          <TabsContent key={entity} value={entity} className="grid gap-6 pt-4">
            <p className="text-sm text-muted-foreground">{ENTITY_LABEL[entity]}</p>
            {view[entity].size === 0 && <EmptyBlock message={`Za ${year} nema cjenovnika za ${entity}.`} />}
            {[...view[entity].entries()].map(([program, rows]) => (
              <Card key={program} className={entity === 'IMH' ? 'border-l-4 border-l-entity-imh' : 'border-l-4 border-l-entity-idss'}>
                <CardHeader>
                  <CardTitle>{PROGRAM_LABEL[program]}</CardTitle>
                </CardHeader>
                <CardContent>
                  <PriceTable rows={rows} />
                </CardContent>
              </Card>
            ))}
            {entity === 'IMH' && view.cap.length > 0 && (
              <PriceCapPanel
                key={`${year}-${approval?.documentNumber ?? 'none'}`}
                schoolYear={year}
                previousYear={previousSchoolYear(year)}
                rows={view.cap}
                approval={approval}
                onApprovalSaved={approvals.reload}
              />
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
