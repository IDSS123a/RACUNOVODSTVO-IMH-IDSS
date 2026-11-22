import { useState } from 'react';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { formatKM } from '@/features/billing/money';
import { formatDate } from '@/lib/format';
import { normalizeUnit } from '@/lib/validation/formats';
import { parsePrice, parseQuantity, type ManualUnit } from '../manual';
import { UnitInput } from './UnitInput';
import { extraServiceLine, previewTotal, type PreviewInvoice } from '../monthly';
import { BASIS_TEMPLATES, SERVICE_TEMPLATES } from '../text-templates';
import { TemplateText } from './TemplateText';

/**
 * One proposed invoice as a compact table (Director, 2026-11-21: „u formatu tabele, kompaktno, jedno ispod drugog“):
 * a header row (institution, child, buyer, due date, total), then one row per line with its tick, description and
 * amount; notes below. Used by „Mjesečni računi“ and „Novi račun“.
 */
export function PreviewInvoiceTable({
  invoice,
  onChange,
  selectable = true,
}: {
  invoice: PreviewInvoice;
  onChange: (change: (p: PreviewInvoice) => PreviewInvoice) => void;
  /** In the monthly list each invoice can be left out as a whole. */
  selectable?: boolean;
}): React.JSX.Element {
  const [adding, setAdding] = useState(false);
  const { header } = invoice;
  const hasExtra = invoice.lines.some((l) => l.line.itemCode === 'OTHER');
  const extrasAllowed = invoice.kind !== 'ENROLMENT_FEES';
  return (
    <table className={`w-full border-collapse overflow-hidden rounded-md border text-sm ${invoice.included ? '' : 'opacity-60'}`}>
      <thead>
        <tr className="bg-muted/60">
          <th className="w-8 p-2 text-left">
            {selectable && (
              <input
                type="checkbox"
                className="size-4"
                aria-label={`Izdaj račun za ${header.childName}`}
                checked={invoice.included}
                onChange={(e) => onChange((p) => ({ ...p, included: e.target.checked }))}
              />
            )}
          </th>
          <th className="p-2 text-left font-medium">
            <Badge className={`mr-2 ${header.entity === 'IMH' ? 'bg-entity-imh-soft text-entity-imh' : 'bg-entity-idss-soft text-entity-idss'}`}>{header.entity}</Badge>
            {header.childName}
            <span className="ml-2 font-normal text-muted-foreground">
              kupac {header.buyerName} · rok {formatDate(header.dueDate)}
              {invoice.kind === 'ENROLMENT_FEES' && ' · račun za upis'}
            </span>
          </th>
          <th className="w-32 p-2 text-right font-semibold tabular-nums">{formatKM(previewTotal(invoice))}</th>
          <th className="w-10" />
        </tr>
      </thead>
      {invoice.included && (
        <tbody>
          {invoice.lines.map((l) => (
            <tr key={l.key} className="border-t align-top">
              <td className="p-2">
                <input
                  type="checkbox"
                  className="size-4"
                  aria-label={`Stavka: ${l.line.description}`}
                  checked={l.selected}
                  onChange={(e) => onChange((p) => ({ ...p, lines: p.lines.map((x) => (x.key === l.key ? { ...x, selected: e.target.checked } : x)) }))}
                />
              </td>
              <td className="p-2">
                <span className={l.selected ? '' : 'text-muted-foreground line-through'}>{l.line.description}</span>
                {l.note && <div className="text-xs text-amber-700 dark:text-amber-400">{l.note}</div>}
              </td>
              <td className="p-2 text-right tabular-nums">{formatKM(l.line.amount)}</td>
              <td className="p-1 text-right">
                {l.line.itemCode === 'OTHER' && (
                  <Button variant="ghost" size="icon" aria-label={`Ukloni: ${l.line.description}`} onClick={() => onChange((p) => ({ ...p, lines: p.lines.filter((x) => x.key !== l.key) }))}>
                    <Trash2Icon aria-hidden />
                  </Button>
                )}
              </td>
            </tr>
          ))}
          {invoice.notes.length > 0 && (
            <tr className="border-t">
              <td />
              <td colSpan={3} className="p-2 text-xs text-muted-foreground">
                {invoice.notes.join(' ')}
              </td>
            </tr>
          )}
          {hasExtra && (
            <tr className="border-t">
              <td />
              <td colSpan={3} className="p-2">
                <TemplateText
                  id={`basis-${invoice.key}`}
                  label="Osnov za uslugu van cjenovnika"
                  templates={BASIS_TEMPLATES}
                  onChange={(text) => onChange((p) => ({ ...p, reason: text ?? '' }))}
                />
              </td>
            </tr>
          )}
          {extrasAllowed && (
            <tr className="border-t">
              <td />
              <td colSpan={3} className="p-2">
                {adding ? (
                  <ExtraServiceForm
                    onCancel={() => setAdding(false)}
                    onAdd={(input) => {
                      onChange((p) => ({ ...p, lines: [...p.lines, extraServiceLine(p, input)] }));
                      setAdding(false);
                    }}
                  />
                ) : (
                  <Button variant="ghost" size="sm" onClick={() => setAdding(true)}>
                    <PlusIcon aria-hidden /> Dodaj uslugu van cjenovnika (nije obavezno)
                  </Button>
                )}
              </td>
            </tr>
          )}
        </tbody>
      )}
    </table>
  );
}

function ExtraServiceForm({
  onAdd,
  onCancel,
}: {
  onAdd: (input: { description: string; unit: ManualUnit; quantity: number; unitPrice: number }) => void;
  onCancel: () => void;
}): React.JSX.Element {
  const [description, setDescription] = useState('');
  const [unit, setUnit] = useState<ManualUnit>('srv');
  const [quantity, setQuantity] = useState('1');
  const [price, setPrice] = useState('');
  const q = parseQuantity(quantity);
  const p = parsePrice(price);
  const valid = description.trim() !== '' && q !== null && p !== null && q * p > 0;
  return (
    <div className="grid gap-2">
      <TemplateText id="extra-desc" label="Naziv usluge" templates={SERVICE_TEMPLATES} onChange={(text) => setDescription(text ?? '')} />
      <div className="flex flex-wrap items-end gap-2">
        <UnitInput id="extra-unit" value={unit} onChange={setUnit} />
        <Input aria-label="Količina" inputMode="numeric" className="h-9 w-20" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
        <Input aria-label="Cijena (KM)" inputMode="decimal" placeholder="Cijena" className="h-9 w-28" value={price} onChange={(e) => setPrice(e.target.value)} />
        <span className="pb-2 text-sm tabular-nums">{q !== null && p !== null ? formatKM(q * p) : '—'}</span>
        <Button size="sm" disabled={!valid} onClick={() => q !== null && p !== null && onAdd({ description, unit: normalizeUnit(unit) ?? 'srv', quantity: q, unitPrice: p })}>
          Dodaj
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Odustani
        </Button>
      </div>
    </div>
  );
}
