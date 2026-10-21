import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ErrorBlock, LoadingBlock } from '@/components/feedback';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SEEDED_SCHOOL_YEARS } from '@/features/price-lists/seed';
import { initialiseApplication } from '@/features/settings/actions';
import { OperatorForm, type OperatorValues } from '@/features/settings/components/OperatorForm';
import { RecoveryKeyStep } from '@/features/settings/components/RecoveryKeyStep';
import { acknowledgeRecoveryKey, getRecoveryKey, getSettings, saveSettings, type Settings } from '@/features/settings/repository';
import { AppShell } from './AppShell';

type Gate =
  | { step: 'loading' }
  | { step: 'error'; message: string }
  | { step: 'recovery-key'; recoveryKey: string }
  | { step: 'operator' }
  | { step: 'ready'; settings: Settings };

/**
 * Start-up flow: open the encrypted database → seed reference data → show the recovery
 * key once → ask for the operator profile on first run → show the application.
 */
export function StartupGate(): React.JSX.Element {
  const [gate, setGate] = useState<Gate>({ step: 'loading' });

  const advance = useCallback(async (): Promise<void> => {
    const init = await initialiseApplication();
    if (!init.success) return setGate({ step: 'error', message: init.error });
    const recovery = await getRecoveryKey();
    if (!recovery.success) return setGate({ step: 'error', message: recovery.error });
    if (recovery.data) return setGate({ step: 'recovery-key', recoveryKey: recovery.data });
    const settings = await getSettings();
    if (!settings.success) return setGate({ step: 'error', message: settings.error });
    if (!settings.data) return setGate({ step: 'operator' });
    setGate({ step: 'ready', settings: settings.data });
  }, []);

  useEffect(() => {
    void advance();
  }, [advance]);

  async function confirmRecoveryKey(): Promise<void> {
    const result = await acknowledgeRecoveryKey();
    if (!result.success) return void toast.error(result.error);
    await advance();
  }

  async function createOperator(operator: OperatorValues): Promise<void> {
    const activeSchoolYear = SEEDED_SCHOOL_YEARS[0] ?? '2026/2027';
    const result = await saveSettings({ operator, backupFolder: '', activeSchoolYear });
    if (!result.success) return void toast.error(result.error);
    toast.success('Dobrodošli! Aplikacija je spremna.');
    await advance();
  }

  switch (gate.step) {
    case 'loading':
      return <LoadingBlock label="Otvaram šifrovanu bazu…" />;
    case 'error':
      return (
        <ErrorBlock
          title="Baza podataka se ne može otvoriti"
          message={gate.message}
          onRetry={() => {
            setGate({ step: 'loading' });
            void advance();
          }}
        />
      );
    case 'recovery-key':
      return <RecoveryKeyStep recoveryKey={gate.recoveryKey} onConfirmed={confirmRecoveryKey} />;
    case 'operator':
      return (
        <Card className="mx-auto mt-10 max-w-2xl">
          <CardHeader>
            <CardTitle>Profil operatera</CardTitle>
            <CardDescription>Unesite svoje podatke. Ime se štampa kao „Fakturisao/la“ na računima.</CardDescription>
          </CardHeader>
          <CardContent>
            <OperatorForm initial={null} submitLabel="Započni rad" onSubmit={createOperator} />
          </CardContent>
        </Card>
      );
    case 'ready':
      return <AppShell settings={gate.settings} onSettingsChanged={() => void advance()} />;
  }
}
