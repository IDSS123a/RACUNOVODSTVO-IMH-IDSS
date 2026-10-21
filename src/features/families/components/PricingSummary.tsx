import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { formatKM } from '@/features/billing/money';
import { BASIS_LABEL, PROGRAM_LABEL, TIER_LABEL } from '@/features/price-lists/types';
import type { FamilyPricingLine } from '../domain';

/**
 * "Ko plaća puni iznos, ko umanjeni" — read-only view of the pricing engine for one family and year.
 * Amounts come from buildFamilyPricing (domain); this component only renders them.
 */
export function PricingSummary({ lines }: { lines: ReadonlyArray<FamilyPricingLine> }): React.JSX.Element {
  if (lines.length === 0) {
    return <p className="text-sm text-muted-foreground">Nema aktivnih upisa za odabranu školsku godinu.</p>;
  }
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Dijete</TableHead>
          <TableHead>Ustanova</TableHead>
          <TableHead>Program</TableHead>
          <TableHead>Redoslijed (po rođenju)</TableHead>
          <TableHead className="text-right">Školarina po cjenovniku</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {lines.map((line) => (
          <TableRow key={`${line.entity}-${line.childId}`}>
            <TableCell className="font-medium">{line.childName}</TableCell>
            <TableCell>
              <Badge className={line.entity === 'IMH' ? 'bg-entity-imh-soft text-entity-imh' : 'bg-entity-idss-soft text-entity-idss'}>
                {line.entity}
              </Badge>
            </TableCell>
            <TableCell>{PROGRAM_LABEL[line.program]}</TableCell>
            <TableCell>{TIER_LABEL[line.tier]}</TableCell>
            <TableCell className="text-right tabular-nums">
              {line.tuition === null ? (
                <span className="text-destructive">{line.problem}</span>
              ) : (
                <>
                  {formatKM(line.tuition)} <span className="text-muted-foreground">{line.basis ? BASIS_LABEL[line.basis] : ''}</span>
                </>
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
