import { formatKM } from '@/features/billing/money';
import { countByCategory, SEVERITY_LABEL, SEVERITY_ORDER, type Finding, type Severity } from '../diagnostics';

/** Entries shown per category in the preview; the Excel report always holds all of them. */
const SHOWN_PER_CATEGORY = 100;

const SEVERITY_CLASS: Readonly<Record<Severity, string>> = {
  BLOCK: 'border-destructive text-destructive',
  ISOLATE: 'border-destructive',
  REVIEW: 'border-amber-500',
  INFO: 'border-border',
};

/**
 * Findings of the import preview, grouped by severity and category, with counts (specs/legacy-import-diagnostics).
 * Each entry shows entity, invoice number and Excel rows, so it can be found in the workbook.
 */
export function FindingsSummary({ findings }: { findings: ReadonlyArray<Finding> }): React.JSX.Element | null {
  if (findings.length === 0) return <p className="text-sm">U dokumentu nije pronađena nijedna nelogičnost.</p>;
  const counts = countByCategory(findings);
  return (
    <div className="grid gap-3" aria-label="Nalazi uvoza">
      <p className="text-sm font-medium">Pronađene nelogičnosti: {findings.length}</p>
      {SEVERITY_ORDER.map((severity) => {
        const ofSeverity = counts.filter((c) => c.severity === severity);
        if (ofSeverity.length === 0) return null;
        const total = ofSeverity.reduce((sum, c) => sum + c.count, 0);
        return (
          <section key={severity} className={`rounded-md border-l-4 pl-3 ${SEVERITY_CLASS[severity]}`}>
            <h4 className="text-sm font-semibold">
              {SEVERITY_LABEL[severity]} ({total})
            </h4>
            {ofSeverity.map((c) => {
              const list = findings.filter((f) => f.category === c.category);
              return (
                <details key={c.category} className="text-sm">
                  <summary className="cursor-pointer py-1">
                    {c.title} — <span className="tabular-nums">{c.count}</span>
                  </summary>
                  <ul className="mb-2 grid gap-1 pl-4">
                    {list.slice(0, SHOWN_PER_CATEGORY).map((f, index) => (
                      <li key={`${f.entity}|${f.number}|${f.excelRows}|${index}`} className="text-muted-foreground">
                        <span className="font-medium text-foreground">
                          {[f.entity, f.number].filter(Boolean).join(' ') || 'Registar'}
                        </span>
                        {f.excelRows && ` · ${f.excelRows}`} · {f.reason}
                        {f.amount !== null && ` · ${formatKM(f.amount)}`}
                      </li>
                    ))}
                  </ul>
                  {list.length > SHOWN_PER_CATEGORY && <p className="pl-4 text-xs">… i još {list.length - SHOWN_PER_CATEGORY} (svi su u Excel izvještaju).</p>}
                </details>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}
