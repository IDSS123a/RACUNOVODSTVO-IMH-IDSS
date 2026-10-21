import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { ErrorBlock, LoadingBlock } from '@/components/feedback';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MONTH_NAME } from '@/features/invoices/types';
import { listSchoolYears } from '@/features/price-lists/repository';
import type { SchoolYear } from '@/features/price-lists/types';
import { Field } from '@/features/settings/components/OperatorForm';
import { useAsyncResult } from '@/lib/use-async-result';
import { listBoardRules, saveBoardRules } from '../repository';
import { SCHOOL_YEAR_MONTHS, type BoardBillingRules } from '../types';

/**
 * Billing parameters decided by the ŠO IDSS for a school year: the latest due date of a plan's last
 * instalment and the months in which breakfast is billed. Entered with the decision reference; never assumed.
 */
export function BoardRulesPanel({ defaultYear }: { defaultYear: SchoolYear }): React.JSX.Element {
  const loadYears = useCallback(() => listSchoolYears(), []);
  const years = useAsyncResult(loadYears);
  const [year, setYear] = useState<SchoolYear>(defaultYear);
  const loadRules = useCallback(() => listBoardRules(year), [year]);
  const rules = useAsyncResult(loadRules);

  const schoolYears = years.state.status === 'ready' ? years.state.data : [defaultYear];
  return (
    <div className="grid gap-4">
      <Field id="rules-year" label="Školska godina">
        <Select value={year} onValueChange={(value) => setYear(value as SchoolYear)}>
          <SelectTrigger id="rules-year" className="w-40">
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
      </Field>
      {rules.state.status === 'loading' && <LoadingBlock />}
      {rules.state.status === 'error' && <ErrorBlock message={rules.state.error} onRetry={rules.reload} />}
      {rules.state.status === 'ready' && (
        <RulesForm
          key={year}
          year={year}
          initial={rules.state.data.find((r) => r.entity === 'IDSS') ?? null}
          onSaved={rules.reload}
        />
      )}
    </div>
  );
}

function RulesForm({ year, initial, onSaved }: { year: SchoolYear; initial: BoardBillingRules | null; onSaved: () => void }): React.JSX.Element {
  const [decisionRef, setDecisionRef] = useState(initial?.decisionRef ?? '');
  const [lastInstalmentBy, setLastInstalmentBy] = useState(initial?.lastInstalmentBy ?? '');
  const [months, setMonths] = useState<number[]>(initial?.breakfastMonths ?? []);
  const [saving, setSaving] = useState(false);

  function toggle(month: number): void {
    setMonths((current) => (current.includes(month) ? current.filter((m) => m !== month) : [...current, month]));
  }

  async function save(): Promise<void> {
    if (!decisionRef.trim()) {
      toast.error('Unesite broj i datum odluke Školskog odbora.');
      return;
    }
    setSaving(true);
    try {
      const result = await saveBoardRules({
        schoolYear: year,
        entity: 'IDSS',
        lastInstalmentBy: lastInstalmentBy || null,
        breakfastMonths: SCHOOL_YEAR_MONTHS.filter((m) => months.includes(m)),
        decisionRef: decisionRef.trim(),
      });
      if (result.success) {
        toast.success('Pravila naplate su sačuvana.');
        onSaved();
      } else toast.error(result.error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <Field id="rules-ref" label="Odluka Školskog odbora (broj i datum)">
          <Input id="rules-ref" value={decisionRef} placeholder="npr. ŠO 7/2026 od 19.02.2026" onChange={(e) => setDecisionRef(e.target.value)} />
        </Field>
        <Field id="rules-deadline" label="Posljednja rata plana najkasnije (prazno = nije odlučeno)">
          <Input id="rules-deadline" type="date" value={lastInstalmentBy} onChange={(e) => setLastInstalmentBy(e.target.value)} />
        </Field>
      </div>
      <fieldset className="grid gap-2">
        <legend className="text-sm font-medium">Mjeseci u kojima se naplaćuje doručak</legend>
        <div className="flex flex-wrap gap-2">
          {SCHOOL_YEAR_MONTHS.map((month) => (
            <Button key={month} type="button" size="sm" variant={months.includes(month) ? 'default' : 'outline'} aria-pressed={months.includes(month)} onClick={() => toggle(month)}>
              {MONTH_NAME[month - 1]}
            </Button>
          ))}
        </div>
        {months.length === 0 && <p className="text-xs text-muted-foreground">Dok nijedan mjesec nije označen, doručak se ne naplaćuje, a pregled računa upozorava na prijavljenu djecu.</p>}
      </fieldset>
      <div>
        <Button disabled={saving} onClick={() => void save()}>
          {saving ? 'Spremanje…' : 'Sačuvaj pravila'}
        </Button>
      </div>
    </div>
  );
}
