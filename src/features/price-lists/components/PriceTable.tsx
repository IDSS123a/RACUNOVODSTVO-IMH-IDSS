import { InfoIcon } from 'lucide-react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { formatKM } from '@/features/billing/money';
import type { PriceTableRow } from '../domain';
import { BASIS_LABEL, ITEM_LABEL, TIER_LABEL } from '../types';

/** Read-only price table of one program. Amounts come straight from the database. */
export function PriceTable({ rows }: { rows: ReadonlyArray<PriceTableRow> }): React.JSX.Element {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Stavka</TableHead>
          <TableHead>Dijete</TableHead>
          <TableHead>Obračun</TableHead>
          <TableHead className="text-right">Domaća lica</TableHead>
          <TableHead className="text-right">Strana lica</TableHead>
          <TableHead className="w-8">
            <span className="sr-only">Izvor</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.key}>
            <TableCell className="font-medium">{ITEM_LABEL[row.item]}</TableCell>
            <TableCell>{TIER_LABEL[row.tier]}</TableCell>
            <TableCell className="text-muted-foreground">{BASIS_LABEL[row.basis]}</TableCell>
            <TableCell className="text-right tabular-nums">{row.domestic === null ? '—' : formatKM(row.domestic)}</TableCell>
            <TableCell className="text-right tabular-nums">{row.foreign === null ? '—' : formatKM(row.foreign)}</TableCell>
            <TableCell>
              <Tooltip>
                <TooltipTrigger aria-label={`Izvor: ${row.source}`} className="text-muted-foreground">
                  <InfoIcon className="size-4" aria-hidden />
                </TooltipTrigger>
                <TooltipContent>{row.source}</TooltipContent>
              </Tooltip>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
