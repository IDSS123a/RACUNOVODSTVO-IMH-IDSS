import { useState } from 'react';
import { DashboardPage } from '@/features/dashboard/components/DashboardPage';
import { InvoicesPage } from '@/features/invoices/components/InvoicesPage';
import { ExportPanel } from '@/features/reports/components/ExportPanel';
import type { LegalEntityCode } from '@/features/price-lists/types';
import { ENTITY_LOGO } from '@/features/settings/logos';
import { ENTITY_STYLE, TASKS, type Task } from '../style';

/** „Dobar dan, <ime>. Šta ćemo danas raditi?“ (DEFINICIJA-APLIKACIJE §4). The name comes from the operator profile. */
export function HomeScreen({ firstName, onTask }: { firstName: string; onTask: (task: Task) => void }): React.JSX.Element {
  return (
    <div className="mx-auto grid w-full max-w-5xl gap-8 py-4">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Dobar dan{firstName ? `, ${firstName}` : ''}.</h1>
        <p className="mt-1 text-lg text-muted-foreground">Šta ćemo danas raditi?</p>
      </header>
      <div className="grid gap-4 md:grid-cols-3">
        {TASKS.map((task) => {
          const Icon = task.icon;
          return (
            <button
              key={task.id}
              type="button"
              onClick={() => onTask(task.id)}
              className="group grid gap-3 rounded-xl border-2 bg-card p-6 text-left shadow-sm transition hover:border-primary hover:shadow-md focus-visible:border-primary"
            >
              <span className="flex items-center gap-3">
                <span className="grid size-12 place-items-center rounded-full bg-primary text-xl font-bold text-primary-foreground">{task.number}</span>
                <Icon aria-hidden className="size-7 text-muted-foreground group-hover:text-primary" />
              </span>
              <span className="text-xl font-semibold">{task.title}</span>
              <span className="text-sm text-muted-foreground">{task.text}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Second click: IMH or IDSS (DEFINICIJA §4) — big cards with the logo, in the institution's colour. */
export function EntityPicker({ task, onPick }: { task: Task; onPick: (entity: LegalEntityCode) => void }): React.JSX.Element {
  const title = TASKS.find((t) => t.id === task)?.title ?? '';
  return (
    <div className="mx-auto grid w-full max-w-4xl gap-6 py-4">
      <h1 className="text-2xl font-semibold tracking-tight">{title} — za koju ustanovu?</h1>
      <div className="grid gap-4 sm:grid-cols-2">
        {(['IMH', 'IDSS'] as const).map((entity) => {
          const style = ENTITY_STYLE[entity];
          return (
            <button
              key={entity}
              type="button"
              onClick={() => onPick(entity)}
              className={`grid gap-4 rounded-xl border-4 ${style.border} ${style.soft} p-6 text-left shadow-sm transition hover:shadow-md`}
            >
              <span className="rounded-md bg-white p-3">
                <img src={ENTITY_LOGO[entity]} alt="" className="h-12 w-auto object-contain object-left" />
              </span>
              <span className={`text-3xl font-bold ${style.text}`}>{entity}</span>
              <span className="text-sm">{style.name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/**
 * „Izvještavanje“ for one institution — operations on existing data only (Director, 2026-11-21): dashboard with
 * statistics and charts, the register to look at (no entry, no payment, no storno) and exports — of THIS institution
 * only. The audit log covers the whole application and stays in the top bar.
 */
export function ReportsFlow({ entity }: { entity: LegalEntityCode }): React.JSX.Element {
  const [tab, setTab] = useState<'dashboard' | 'register' | 'export'>('dashboard');
  const style = ENTITY_STYLE[entity];
  const tabs = [
    ['dashboard', 'Kontrolni panel'],
    ['register', 'Registar faktura'],
    ['export', 'Izvoz (XLSX, CSV, DOCX)'],
  ] as const;
  return (
    <div className="grid gap-5">
      <nav className="flex flex-wrap gap-2" aria-label="Izvještaji">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            aria-current={tab === id ? 'page' : undefined}
            onClick={() => setTab(id)}
            className={`rounded-lg border-2 px-4 py-2 font-semibold ${tab === id ? `${style.border} ${style.soft}` : 'border-transparent bg-muted/50 hover:bg-muted'}`}
          >
            {label}
          </button>
        ))}
      </nav>
      {tab === 'dashboard' && <DashboardPage initialEntity={entity} compact />}
      {tab === 'register' && <InvoicesPage initialEntity={entity} readOnly />}
      {tab === 'export' && <ExportPanel entity={entity} />}
    </div>
  );
}
