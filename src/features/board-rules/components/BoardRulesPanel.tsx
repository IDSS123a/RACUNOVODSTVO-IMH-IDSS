import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { ErrorBlock, LoadingBlock } from '@/components/feedback';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { TemplateText } from '@/features/invoices/components/TemplateText';
import { BASIS_TEMPLATES } from '@/features/invoices/text-templates';
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
/** A ŠO IDSS decision: „Odluka ŠO IDSS br. 7/2026 od 19.02.2026.“ */
const DECISION_TEMPLATES = BASIS_TEMPLATES.filter((t) => t.id === 'so');

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
  // assembled from the template (identical syntax, DL-P017); the saved text is shown below it
  const [decisionRef, setDecisionRef] = useState('');
  const [lastInstalmentBy, setLastInstalmentBy] = useState(initial?.lastInstalmentBy ?? '');
  const [months, setMonths] = useState<number[]>(initial?.breakfastMonths ?? []);
  const [saving, setSaving] = useState(false);

  function toggle(month: number): void {
    setMonths((current) => (current.includes(month) ? current.filter((m) => m !== month) : [...current, month]));
  }

  async function save(): Promise<void> {
    if (!decisionRef.trim()) {
      toast.error('Popunite broj i datum odluke Školskog odbora (šablon).');
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
        <div className="grid gap-1">
          <TemplateText id="rules-ref" label="Odluka Školskog odbora (broj i datum)" templates={DECISION_TEMPLATES} onChange={(text) => setDecisionRef(text ?? '')} />
          {initial?.decisionRef && <p className="text-xs text-muted-foreground">Sačuvano: „{initial.decisionRef}“</p>}
        </div>
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
