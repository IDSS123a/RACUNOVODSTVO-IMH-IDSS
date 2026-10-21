import { useCallback } from 'react';
import { toast } from 'sonner';
import { ErrorBlock, LoadingBlock } from '@/components/feedback';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { BoardRulesPanel } from '@/features/board-rules/components/BoardRulesPanel';
import type { SchoolYear } from '@/features/price-lists/types';
import { useAsyncResult } from '@/lib/use-async-result';
import { listInstitutions, saveSettings, type Settings } from '../repository';
import { BackupPanel } from './BackupPanel';
import { InstitutionForm } from './InstitutionForm';
import { OperatorForm, type OperatorValues } from './OperatorForm';

/** Settings screen: operator, institutions, board billing rules, backups. */
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
