import { useState } from 'react';
import { CopyIcon, KeyRoundIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';

/**
 * First-run step: show the database recovery key once (DL-P004).
 * The operator must confirm it was printed or stored before continuing.
 */
export function RecoveryKeyStep({
  recoveryKey,
  onConfirmed,
}: {
  recoveryKey: string;
  onConfirmed: () => Promise<void>;
}): React.JSX.Element {
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);

  async function copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(recoveryKey);
      toast.success('Ključ je kopiran. Zalijepite ga u dokument koji ćete odštampati, pa ga obrišite iz međuspremnika.');
    } catch {
      toast.error('Kopiranje nije uspjelo. Prepišite ključ ručno.');
    }
  }

  async function finish(): Promise<void> {
    setBusy(true);
    try {
      await onConfirmed();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mx-auto mt-10 max-w-2xl">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRoundIcon className="size-5" aria-hidden /> Ključ za oporavak baze
        </CardTitle>
        <CardDescription>
          Svi podaci su šifrovani i vezani za ovaj Windows nalog. Ključ ispod je jedini način da se rezervna kopija
          otvori na drugom računaru ili nakon reinstalacije Windowsa. Prikazuje se samo sada.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4">
        <code className="block break-all rounded-md border bg-muted p-4 font-mono text-sm select-all" aria-label="Ključ za oporavak">
          {recoveryKey}
        </code>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Odštampajte ključ i predajte ga direktoru na čuvanje (sef).</li>
          <li>Ne šaljite ga emailom niti porukom.</li>
          <li>Bez ovog ključa izgubljena baza se ne može vratiti.</li>
        </ol>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} className="size-4" />
          Ključ je odštampan i sačuvan na sigurnom mjestu.
        </label>
      </CardContent>
      <CardFooter className="flex gap-2">
        <Button variant="outline" onClick={() => void copy()}>
          <CopyIcon aria-hidden /> Kopiraj
        </Button>
        <Button disabled={!confirmed || busy} onClick={() => void finish()}>
          {busy ? 'Spremanje…' : 'Nastavi'}
        </Button>
      </CardFooter>
    </Card>
  );
}
