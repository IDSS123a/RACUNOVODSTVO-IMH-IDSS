import { useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { defaultValues, formatFreeText, FREE_TEXT_ID, FREE_TEXT_LABEL, FREE_TEXT_MAX, renderTemplate, type TemplateValues, type TextTemplate } from '../text-templates';
import { MONTH_NAME } from '../types';

const SELECT = 'h-9 rounded-md border bg-transparent px-2 text-sm';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * A text entry built from a template (Director, 2026-11-21: identical syntax for every entry). The operator picks the
 * template and fills typed fields; `onChange` receives the assembled text, or null while a field is missing.
 * Every field can also be written differently (Director, 2026-11-22): proposed values can be overtyped, and the last
 * choice of every list, „Drugačije — upišite sami“, takes a free text.
 */
export function TemplateText({
  id,
  label,
  templates,
  known,
  onChange,
}: {
  id: string;
  label: string;
  templates: ReadonlyArray<TextTemplate>;
  /** Values the screen already knows (invoice number, month of the invoice …). */
  known?: TemplateValues;
  onChange: (text: string | null) => void;
}): React.JSX.Element {
  const first = templates[0];
  if (!first) throw new Error('no templates');
  const [templateId, setTemplateId] = useState(first.id);
  const template = templates.find((t) => t.id === templateId) ?? first;
  const [values, setValues] = useState<Record<string, string>>(() => defaultValues(first, today(), known));
  const [free, setFree] = useState('');
  const isFree = templateId === FREE_TEXT_ID;
  const text = useMemo(() => (isFree ? formatFreeText(free) : renderTemplate(template, values)), [isFree, free, template, values]);
  // report only when the text changes (the caller's callback may be a new function on every render)
  const report = useRef(onChange);
  report.current = onChange;
  useEffect(() => report.current(text), [text]);

  const choose = (next: string) => {
    if (next === FREE_TEXT_ID) {
      // start from the text the template gave, so a small change does not mean typing everything again
      setFree(text ?? '');
      setTemplateId(FREE_TEXT_ID);
      return;
    }
    const t = templates.find((x) => x.id === next) ?? first;
    setTemplateId(t.id);
    setValues(defaultValues(t, today(), known));
  };

  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1 text-sm font-medium">{label}</legend>
      <div className="flex flex-wrap items-end gap-2">
        <select id={id} aria-label={`${label} — šablon`} className={SELECT} value={templateId} onChange={(e) => choose(e.target.value)}>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.label}
            </option>
          ))}
          <option value={FREE_TEXT_ID}>{FREE_TEXT_LABEL}</option>
        </select>
        {isFree && (
          <Input
            aria-label={`${label} — slobodan unos`}
            className="h-9 w-full sm:max-w-xl"
            maxLength={FREE_TEXT_MAX}
            placeholder="Upišite tekst kako treba da stoji"
            value={free}
            onChange={(e) => setFree(e.target.value)}
          />
        )}
        {!isFree && template.params.map((param) => {
          const value = values[param.key] ?? '';
          const set = (v: string) => setValues((all) => ({ ...all, [param.key]: v }));
          const aria = `${label} — ${param.label}`;
          if (param.kind === 'month') {
            return (
              <select key={param.key} aria-label={aria} className={SELECT} value={value} onChange={(e) => set(e.target.value)}>
                {MONTH_NAME.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            );
          }
          if (param.kind === 'date') return <Input key={param.key} aria-label={aria} type="date" className="h-9 w-40" value={value} onChange={(e) => set(e.target.value)} />;
          if (param.options) {
            // proposed values in a list, but any other value can be typed (`list` + `datalist`)
            const listId = `${id}-${param.key}-options`;
            return (
              <span key={param.key}>
                <Input aria-label={aria} list={listId} className="h-9 w-48" placeholder={param.label} value={value} onChange={(e) => set(e.target.value)} />
                <datalist id={listId}>
                  {param.options.map((o) => (
                    <option key={o} value={o} />
                  ))}
                </datalist>
              </span>
            );
          }
          const width = param.kind === 'text' ? 'w-56' : param.kind === 'schoolYear' ? 'w-28' : 'w-24';
          const placeholder = param.kind === 'schoolYear' ? '2026/2027' : param.kind === 'year' ? '2026' : param.label;
          return (
            <Input
              key={param.key}
              aria-label={aria}
              className={`h-9 ${width}`}
              inputMode={param.kind === 'year' || param.kind === 'count' ? 'numeric' : undefined}
              placeholder={placeholder}
              value={value}
              onChange={(e) => set(e.target.value)}
            />
          );
        })}
      </div>
      <p className={`text-xs ${text ? 'text-muted-foreground' : 'text-destructive'}`}>
        {text ? `Upisuje se: „${text}“` : isFree ? `Upišite tekst (2–${FREE_TEXT_MAX} znakova).` : 'Popunite sva polja šablona.'}
      </p>
    </fieldset>
  );
}
