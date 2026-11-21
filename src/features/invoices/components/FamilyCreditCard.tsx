import { useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { formatKM } from '@/features/billing/money';
import { useAsyncResult } from '@/lib/use-async-result';
import { creditByEntity } from '../credit-notes';
import { listFamilyCredit } from '../repository';

/**
 * „Kredit porodice“ (S3): money paid above what the family owes on an invoice — e.g. after a credit note.
 * Shown per institution (never mixed). It is moved or refunded from the invoice that carries it.
 * Renders nothing when the family has no credit.
 */
export function FamilyCreditCard({ familyId }: { familyId: string }): React.JSX.Element | null {
  const load = useCallback(() => listFamilyCredit(familyId), [familyId]);
  const credit = useAsyncResult(load);
  if (credit.state.status !== 'ready' || credit.state.data.length === 0) return null;
  const rows = credit.state.data;
  return (
    <Card>
      <CardHeader>
        <CardTitle>Kredit porodice</CardTitle>
        <CardDescription>
          Višak uplata (npr. nakon knjižnog odobrenja). Otvorite račun u modulu Računi da kredit prebacite na drugi račun iste ustanove ili evidentirate povrat.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-2 text-sm">
        {[...creditByEntity(rows)].map(([entity, total]) => (
          <div key={entity}>
            <p className="font-medium">
              {entity}: <span className="tabular-nums">{formatKM(total)}</span>
            </p>
            <ul className="pl-4 text-muted-foreground">
              {rows
                .filter((r) => r.entity === entity)
                .map((r) => (
                  <li key={r.invoiceId}>
                    račun {r.number}: <span className="tabular-nums">{formatKM(r.credit)}</span>
                  </li>
                ))}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
