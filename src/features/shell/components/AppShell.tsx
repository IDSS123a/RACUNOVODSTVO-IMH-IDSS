import { useState } from 'react';
import { MonitorIcon, MoonIcon, SettingsIcon, SunIcon, TableIcon, UsersIcon } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { FamiliesPage } from '@/features/families/components/FamiliesPage';
import { PriceListPage } from '@/features/price-lists/components/PriceListPage';
import type { SchoolYear } from '@/features/price-lists/types';
import { SettingsPage } from '@/features/settings/components/SettingsPage';
import type { Settings } from '@/features/settings/repository';

type Page = 'families' | 'price-lists' | 'settings';

const NAV: ReadonlyArray<{ id: Page; label: string; icon: typeof TableIcon }> = [
  { id: 'families', label: 'Porodice', icon: UsersIcon },
  { id: 'price-lists', label: 'Cjenovnik', icon: TableIcon },
  { id: 'settings', label: 'Postavke', icon: SettingsIcon },
];

/**
 * Application shell: sidebar navigation + content. Only working screens are listed;
 * invoices and the ministry cycle are added in later sprints (no placeholder menus).
 */
export function AppShell({ settings, onSettingsChanged }: { settings: Settings; onSettingsChanged: () => void }): React.JSX.Element {
  const [page, setPage] = useState<Page>('families');

  return (
    <div className="grid min-h-screen grid-cols-[15rem_1fr]">
      <aside className="flex flex-col border-r bg-sidebar text-sidebar-foreground">
        <div className="px-5 py-5">
          <p className="text-lg font-semibold tracking-tight">Fakturisanje</p>
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-entity-imh">IMH</span> · <span className="font-medium text-entity-idss">IDSS</span>
          </p>
        </div>
        <Separator />
        <nav aria-label="Glavni meni" className="grid gap-1 p-3">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active = page === item.id;
            return (
              <Button
                key={item.id}
                variant={active ? 'secondary' : 'ghost'}
                className="justify-start"
                aria-current={active ? 'page' : undefined}
                onClick={() => setPage(item.id)}
              >
                <Icon aria-hidden /> {item.label}
              </Button>
            );
          })}
        </nav>
        <div className="mt-auto grid gap-3 p-4 text-xs">
          <ThemeSwitch />
          <div>
            <p className="font-medium">{settings.operator.fullName}</p>
            {settings.operator.jobTitle && <p className="text-muted-foreground">{settings.operator.jobTitle}</p>}
          </div>
        </div>
      </aside>
      <main className="min-w-0 overflow-auto p-8">
        {page === 'families' && <FamiliesPage defaultYear={settings.activeSchoolYear as SchoolYear} />}
        {page === 'price-lists' && <PriceListPage initialYear={settings.activeSchoolYear as SchoolYear} />}
        {page === 'settings' && <SettingsPage settings={settings} onSettingsChanged={onSettingsChanged} />}
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
