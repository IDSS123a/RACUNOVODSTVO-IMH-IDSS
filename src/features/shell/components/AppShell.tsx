import { useCallback, useEffect, useState } from 'react';
import { ArrowLeftIcon, ClipboardCheckIcon, HistoryIcon, HomeIcon, MonitorIcon, MoonIcon, SettingsIcon, SunIcon, TableIcon, UsersIcon } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { AuditLogPage } from '@/features/dashboard/components/AuditLogPage';
import { FamiliesPage } from '@/features/families/components/FamiliesPage';
import { ReviewFindingsPage } from '@/features/legacy-import/components/ReviewFindingsPage';
import { importFindingsOpenCount } from '@/features/legacy-import/repository';
import { PriceListPage } from '@/features/price-lists/components/PriceListPage';
import type { LegalEntityCode, SchoolYear } from '@/features/price-lists/types';
import { SettingsPage } from '@/features/settings/components/SettingsPage';
import { ENTITY_LOGO } from '@/features/settings/logos';
import type { Settings } from '@/features/settings/repository';
import { BillingFlow } from '@/features/workflow/components/BillingFlow';
import { OtherFlow } from '@/features/workflow/components/OtherFlow';
import { EntityPicker, HomeScreen, ReportsFlow } from '@/features/workflow/components/Screens';
import { ENTITY_STYLE, TASKS, type Task } from '@/features/workflow/style';

type DataPage = 'families' | 'price-lists' | 'audit' | 'settings' | 'review';
type Route = { kind: 'home' } | { kind: 'task'; task: Task; entity: LegalEntityCode | null } | { kind: 'data'; page: DataPage; back: Route };

const DATA_PAGES: ReadonlyArray<{ id: DataPage; label: string; icon: typeof TableIcon }> = [
  { id: 'families', label: 'Porodice i djeca', icon: UsersIcon },
  { id: 'price-lists', label: 'Cjenovnik', icon: TableIcon },
  { id: 'audit', label: 'Dnevnik izmjena', icon: HistoryIcon },
  { id: 'settings', label: 'Postavke', icon: SettingsIcon },
];

/**
 * The guided application (DEFINICIJA-APLIKACIJE §4, specs/guided-flow): home „Dobar dan … Šta ćemo danas raditi?“ →
 * task → IMH or IDSS → big steps in the institution's colour. Master data (families, price list, settings) is one
 * click away in the top bar, edited directly (DEFINICIJA M8). Edge to edge on every screen.
 */
export function AppShell({ settings, onSettingsChanged }: { settings: Settings; onSettingsChanged: () => void }): React.JSX.Element {
  const [route, setRoute] = useState<Route>({ kind: 'home' });
  const [openFindings, setOpenFindings] = useState(0);
  const refreshFindings = useCallback(async (): Promise<void> => {
    const result = await importFindingsOpenCount();
    if (result.success) setOpenFindings(result.data);
  }, []);
  useEffect(() => {
    void refreshFindings();
  }, [route, refreshFindings]);

  const firstName = settings.operator.fullName.trim().split(/\s+/)[0] ?? '';
  const year = settings.activeSchoolYear as SchoolYear;
  const openData = (page: DataPage) => setRoute((current) => ({ kind: 'data', page, back: current.kind === 'data' ? current.back : current }));
  const flowEntity = route.kind === 'task' ? route.entity : null;
  const style = flowEntity ? ENTITY_STYLE[flowEntity] : null;

  return (
    <div className="flex h-dvh flex-col">
      <header className="flex flex-wrap items-center gap-2 border-b bg-sidebar px-3 py-2 text-sidebar-foreground sm:px-4">
        <Button variant={route.kind === 'home' ? 'secondary' : 'ghost'} onClick={() => setRoute({ kind: 'home' })}>
          <HomeIcon aria-hidden /> Početna
        </Button>
        <span className="hidden font-semibold tracking-tight sm:inline">Fakturisanje IMH &amp; IDSS</span>
        <nav aria-label="Podaci" className="ml-auto flex flex-wrap items-center gap-1">
          {DATA_PAGES.map((p) => {
            const Icon = p.icon;
            return (
              <Button key={p.id} variant={route.kind === 'data' && route.page === p.id ? 'secondary' : 'ghost'} size="sm" onClick={() => openData(p.id)}>
                <Icon aria-hidden /> <span className="hidden lg:inline">{p.label}</span>
              </Button>
            );
          })}
          {openFindings > 0 && (
            <Button variant="ghost" size="sm" onClick={() => openData('review')}>
              <ClipboardCheckIcon aria-hidden /> <span className="hidden lg:inline">Za provjeru</span>
              <span className="rounded-full bg-amber-500 px-2 text-xs font-semibold text-white tabular-nums">{openFindings}</span>
            </Button>
          )}
          <ThemeSwitch />
        </nav>
      </header>

      {route.kind === 'task' && route.entity && style && (
        <div className={`flex flex-wrap items-center gap-3 border-b-4 ${style.border} ${style.soft} px-3 py-2 sm:px-4`}>
          <Button variant="ghost" size="sm" onClick={() => setRoute({ ...route, entity: null })}>
            <ArrowLeftIcon aria-hidden /> Druga ustanova
          </Button>
          <span className="rounded bg-white p-1">
            <img src={ENTITY_LOGO[route.entity]} alt="" className="h-7 w-auto" />
          </span>
          <span className={`text-lg font-bold ${style.text}`}>
            {TASKS.find((t) => t.id === route.task)?.number}. {TASKS.find((t) => t.id === route.task)?.title} — {route.entity}
          </span>
        </div>
      )}

      <main className="min-h-0 min-w-0 flex-1 overflow-auto p-3 sm:p-4 lg:p-6">
        {route.kind === 'home' && <HomeScreen firstName={firstName} onTask={(task) => setRoute({ kind: 'task', task, entity: null })} />}
        {route.kind === 'task' && !route.entity && <EntityPicker task={route.task} onPick={(entity) => setRoute({ ...route, entity })} />}
        {route.kind === 'task' && route.entity && route.task === 'billing' && <BillingFlow key={route.entity} entity={route.entity} onOpenFamilies={() => openData('families')} />}
        {route.kind === 'task' && route.entity && route.task === 'other' && <OtherFlow key={route.entity} entity={route.entity} />}
        {route.kind === 'task' && route.entity && route.task === 'reports' && <ReportsFlow key={route.entity} entity={route.entity} />}
        {route.kind === 'data' && (
          <div className="grid gap-4">
            <div>
              <Button variant="outline" onClick={() => setRoute(route.back)}>
                <ArrowLeftIcon aria-hidden /> Nazad
              </Button>
            </div>
            {route.page === 'families' && <FamiliesPage defaultYear={year} />}
            {route.page === 'price-lists' && <PriceListPage initialYear={year} />}
            {route.page === 'audit' && <AuditLogPage />}
            {route.page === 'settings' && <SettingsPage settings={settings} onSettingsChanged={onSettingsChanged} />}
            {route.page === 'review' && <ReviewFindingsPage onChanged={() => void refreshFindings()} />}
          </div>
        )}
      </main>
    </div>
  );
}

const THEMES = [
  { id: 'light', label: 'Svijetla tema', icon: SunIcon },
  { id: 'dark', label: 'Tamna tema', icon: MoonIcon },
  { id: 'system', label: 'Tema sistema', icon: MonitorIcon },
] as const;

function ThemeSwitch(): React.JSX.Element {
  const { theme, setTheme } = useTheme();
  return (
    <div role="radiogroup" aria-label="Tema" className="flex gap-1">
      {THEMES.map((option) => {
        const Icon = option.icon;
        return (
          <Button
            key={option.id}
            role="radio"
            aria-checked={theme === option.id}
            aria-label={option.label}
            title={option.label}
            variant={theme === option.id ? 'secondary' : 'ghost'}
            size="icon"
            onClick={() => setTheme(option.id)}
          >
            <Icon aria-hidden />
          </Button>
        );
      })}
    </div>
  );
}
