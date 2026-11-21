import { useCallback, useEffect, useState } from 'react';
import { ClipboardCheckIcon, FileTextIcon, MenuIcon, MonitorIcon, MoonIcon, SettingsIcon, SunIcon, TableIcon, UsersIcon, XIcon } from 'lucide-react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { FamiliesPage } from '@/features/families/components/FamiliesPage';
import { InvoicesPage } from '@/features/invoices/components/InvoicesPage';
import { ReviewFindingsPage } from '@/features/legacy-import/components/ReviewFindingsPage';
import { importFindingsOpenCount } from '@/features/legacy-import/repository';
import { PriceListPage } from '@/features/price-lists/components/PriceListPage';
import type { SchoolYear } from '@/features/price-lists/types';
import { SettingsPage } from '@/features/settings/components/SettingsPage';
import { ENTITY_LOGO } from '@/features/settings/logos';
import type { Settings } from '@/features/settings/repository';

type Page = 'invoices' | 'families' | 'price-lists' | 'settings' | 'review';

const NAV: ReadonlyArray<{ id: Page; label: string; icon: typeof TableIcon }> = [
  { id: 'invoices', label: 'Računi', icon: FileTextIcon },
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
  // Open findings of the legacy import stay visible in the menu until resolved (Director, Q4).
  const [openFindings, setOpenFindings] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const refreshFindings = useCallback(async (): Promise<void> => {
    const result = await importFindingsOpenCount();
    if (result.success) setOpenFindings(result.data);
  }, []);
  useEffect(() => {
    void refreshFindings();
  }, [page, refreshFindings]);

  return (
    // Edge to edge on every screen: a fixed sidebar from laptop width (lg), a top bar with a slide-in menu below it.
    <div className="flex h-dvh flex-col lg:grid lg:grid-cols-[14rem_minmax(0,1fr)]">
      <header className="flex items-center justify-between border-b bg-sidebar px-3 py-2 text-sidebar-foreground lg:hidden">
        <p className="font-semibold tracking-tight">Fakturisanje</p>
        <Button variant="ghost" size="icon" aria-label={menuOpen ? 'Zatvori meni' : 'Otvori meni'} aria-expanded={menuOpen} onClick={() => setMenuOpen((o) => !o)}>
          {menuOpen ? <XIcon aria-hidden /> : <MenuIcon aria-hidden />}
        </Button>
      </header>
      {menuOpen && <div className="fixed inset-0 z-30 bg-black/40 lg:hidden" aria-hidden onClick={() => setMenuOpen(false)} />}
      <aside
        className={`${menuOpen ? 'fixed inset-y-0 left-0 z-40 flex w-64 shadow-xl' : 'hidden'} flex-col overflow-y-auto border-r bg-sidebar text-sidebar-foreground lg:static lg:flex lg:w-auto lg:shadow-none`}
      >
        <div className="grid gap-3 px-5 py-5">
          <p className="text-lg font-semibold tracking-tight">Fakturisanje</p>
          {/* Logos sit on a white plate so they stay legible in the dark theme. */}
          <div className="grid gap-2 rounded-md bg-white p-2">
            <img src={ENTITY_LOGO.IMH} alt="The Montessori House (IMH)" className="h-7 w-auto object-contain object-left" />
            <img src={ENTITY_LOGO.IDSS} alt="Internationale Deutsche Schule Sarajevo (IDSS)" className="h-7 w-auto object-contain object-left" />
          </div>
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
                onClick={() => {
                  setPage(item.id);
                  setMenuOpen(false);
                }}
              >
                <Icon aria-hidden /> {item.label}
              </Button>
            );
          })}
          {(openFindings > 0 || page === 'review') && (
            <Button
              variant={page === 'review' ? 'secondary' : 'ghost'}
              className="justify-start"
              aria-current={page === 'review' ? 'page' : undefined}
              onClick={() => {
                setPage('review');
                setMenuOpen(false);
              }}
            >
              <ClipboardCheckIcon aria-hidden /> Za provjeru
              {openFindings > 0 && <span className="ml-auto rounded-full bg-amber-500 px-2 text-xs font-semibold text-white tabular-nums">{openFindings}</span>}
            </Button>
          )}
        </nav>
        <div className="mt-auto grid gap-3 p-4 text-xs">
          <ThemeSwitch />
          <div>
            <p className="font-medium">{settings.operator.fullName}</p>
            {settings.operator.jobTitle && <p className="text-muted-foreground">{settings.operator.jobTitle}</p>}
          </div>
        </div>
      </aside>
      <main className="min-h-0 min-w-0 flex-1 overflow-auto p-3 sm:p-4 lg:p-6">
        {page === 'invoices' && <InvoicesPage />}
        {page === 'families' && <FamiliesPage defaultYear={settings.activeSchoolYear as SchoolYear} />}
        {page === 'price-lists' && <PriceListPage initialYear={settings.activeSchoolYear as SchoolYear} />}
        {page === 'settings' && <SettingsPage settings={settings} onSettingsChanged={onSettingsChanged} />}
        {page === 'review' && <ReviewFindingsPage onChanged={() => void refreshFindings()} />}
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
