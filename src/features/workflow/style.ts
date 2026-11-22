import { useEffect, useState } from 'react';
import { BarChart3Icon, FilePlus2Icon, ReceiptTextIcon } from 'lucide-react';
import type { PeriodFilter } from '@/features/invoices/pdf-actions';
import type { InvoiceSummary } from '@/features/invoices/repository';
import type { LegalEntityCode } from '@/features/price-lists/types';

const pdfActions = () => import('@/features/invoices/pdf-actions');

/** Colours of each institution (DEFINICIJA-APLIKACIJE §4): every screen of a flow carries them. */
export const ENTITY_STYLE: Readonly<Record<LegalEntityCode, { text: string; bg: string; soft: string; border: string; name: string }>> = {
  IMH: { text: 'text-entity-imh', bg: 'bg-entity-imh', soft: 'bg-entity-imh-soft', border: 'border-entity-imh', name: 'International Montessori House' },
  IDSS: { text: 'text-entity-idss', bg: 'bg-entity-idss', soft: 'bg-entity-idss-soft', border: 'border-entity-idss', name: 'Internationale Deutsche Schule Sarajevo' },
};

/** The invoices a print/send step works on. `refresh` reloads them after new invoices were issued. */
export function useStepInvoices(filter: PeriodFilter, refresh: number): { invoices: InvoiceSummary[] | null; error: string | null } {
  const [state, setState] = useState<{ invoices: InvoiceSummary[] | null; error: string | null }>({ invoices: null, error: null });
  const key = JSON.stringify(filter);
  useEffect(() => {
    let cancelled = false;
    void pdfActions()
      .then((m) => m.invoicesInPeriod(JSON.parse(key) as PeriodFilter))
      .then((result) => {
        if (!cancelled) setState(result.success ? { invoices: result.data, error: null } : { invoices: null, error: result.error });
      });
    return () => {
      cancelled = true;
    };
  }, [key, refresh]);
  return state;
}

/** The month after the given date (`YYYY-MM`): monthly invoices are made for the next month (DEFINICIJA §1). */
export function nextMonth(today: string): string {
  const [y, m] = today.split('-').map(Number);
  if (!y || !m) return today.slice(0, 7);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
}

/** The three tasks of the home screen (DEFINICIJA-APLIKACIJE §4). */
export type Task = 'billing' | 'other' | 'reports';

export const TASKS: ReadonlyArray<{ id: Task; number: number; title: string; text: string; icon: typeof BarChart3Icon }> = [
  { id: 'billing', number: 1, title: 'Fakturisanje', text: 'Mjesečne fakture po cjenovniku: školarina, upisnina, potrošni materijal, produženi boravak, doručak.', icon: ReceiptTextIcon },
  { id: 'other', number: 2, title: 'Ostalo fakturisanje', text: 'Sve što nije u cjenovniku: ljetna škola, sekcija, izlet …', icon: FilePlus2Icon },
  { id: 'reports', number: 3, title: 'Izvještavanje', text: 'Pregled izdatih i naplaćenih faktura, registar, izvoz i dnevnik izmjena.', icon: BarChart3Icon },
];

