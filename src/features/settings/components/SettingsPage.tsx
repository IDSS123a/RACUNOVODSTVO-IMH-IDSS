import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { ErrorBlock, LoadingBlock } from '@/components/feedback';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BoardRulesPanel } from '@/features/board-rules/components/BoardRulesPanel';
import { LegacyImportPanel } from '@/features/legacy-import/components/LegacyImportPanel';
import type { SchoolYear } from '@/features/price-lists/types';
import { useAsyncResult } from '@/lib/use-async-result';
import { listInstitutions, saveSettings, type Settings } from '../repository';
import { BackupPanel } from './BackupPanel';
import { InstitutionForm } from './InstitutionForm';
import { OperatorForm, type OperatorValues } from './OperatorForm';

/** Settings screen: operator, institutions, board billing rules, legacy import, backups. */
export function SettingsPage({ settings, onSettingsChanged }: { settings: Settings; onSettingsChanged: () => void }): React.JSX.Element {
  const loadInstitutions = useCallback(() => listInstitutions(), []);
  const institutions = useAsyncResult(loadInstitutions);

  async function saveOperator(operator: OperatorValues): Promise<void> {
    const result = await saveSettings({ ...settings, operator });
    if (result.success) {
      toast.success('Profil operatera je sačuvan.');
      onSettingsChanged();
    } else toast.error(result.error);
  }

  return (
    <div className="grid gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Postavke</h1>
        <p className="text-sm text-muted-foreground">Operater, podaci ustanova, pravila naplate i rezervne kopije.</p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle>Operater</CardTitle>
          <CardDescription>Ime se štampa kao „Fakturisao/la“ na računima. Čuva se samo u šifrovanoj bazi.</CardDescription>
        </CardHeader>
        <CardContent>
          <OperatorForm initial={settings.operator} submitLabel="Sačuvaj profil" onSubmit={saveOperator} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Ustanove</CardTitle>
          <CardDescription>Zvanični podaci iz memoranduma. Pojavljuju se u zaglavlju računa.</CardDescription>
        </CardHeader>
        <CardContent>
          {institutions.state.status === 'loading' && <LoadingBlock />}
          {institutions.state.status === 'error' && <ErrorBlock message={institutions.state.error} onRetry={institutions.reload} />}
          {institutions.state.status === 'ready' && (
            <Tabs defaultValue="IMH">
              <TabsList>
                {institutions.state.data.map((institution) => (
                  <TabsTrigger key={institution.code} value={institution.code}>
                    {institution.code}
                  </TabsTrigger>
                ))}
              </TabsList>
              {institutions.state.data.map((institution) => (
                <TabsContent key={institution.code} value={institution.code} className="pt-4">
                  <InstitutionForm institution={institution} onSaved={institutions.reload} />
                </TabsContent>
              ))}
            </Tabs>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Pravila naplate — odluke Školskog odbora IDSS</CardTitle>
          <CardDescription>Rok posljednje rate plana i mjeseci naplate doručka. Unosi se samo ono što je odbor odlučio, s brojem odluke; svaka izmjena se bilježi u log.</CardDescription>
        </CardHeader>
        <CardContent>
          <BoardRulesPanel defaultYear={settings.activeSchoolYear as SchoolYear} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Uvoz iz starog rješenja (Excel)</CardTitle>
          <CardDescription>
            Računi (list „DB“) i spisak porodica (list „Setting“) iz dokumenta Faktura_IDSS_&_IMH. Prvo se prikaže šta će se uvesti, a tek onda se uvozi. Uvoz se može ponoviti s novijim dokumentom — ništa se ne duplira.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LegacyImportPanel />
        </CardContent>
      </Card>

      {import.meta.env.DEV && <DemoDataCard schoolYear={settings.activeSchoolYear as SchoolYear} />}

      <Card>
        <CardHeader>
          <CardTitle>Rezervne kopije</CardTitle>
          <CardDescription>Šifrovane kopije cijele baze.</CardDescription>
        </CardHeader>
        <CardContent>
          <BackupPanel settings={settings} onSettingsSaved={onSettingsChanged} />
        </CardContent>
      </Card>
    </div>
  );
}

/** DEVELOPMENT ONLY (never rendered in the installed build): load fictional demo families for walkthroughs. */
function DemoDataCard({ schoolYear }: { schoolYear: SchoolYear }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  async function load(): Promise<void> {
    setBusy(true);
    try {
      const { loadDemoData } = await import('@/features/dev/demo-data');
      const result = await loadDemoData(schoolYear);
      if (result.success) toast.success(result.data);
      else toast.error(result.error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle>Demo podaci (samo razvojna verzija)</CardTitle>
        <CardDescription>Izmišljene porodice za probu, školska godina {schoolYear}. Ovo dugme ne postoji u verziji koja se instalira kod operatera.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" disabled={busy} onClick={() => void load()}>
          {busy ? 'Učitavam…' : 'Učitaj demo podatke'}
        </Button>
      </CardContent>
    </Card>
  );
}
