import { useCallback, useMemo, useState } from 'react';
import { SaveIcon } from 'lucide-react';
import { toast } from 'sonner';
import { ErrorBlock, LoadingBlock } from '@/components/feedback';
import { FormDialog } from '@/components/form-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { listInvoices } from '@/features/invoices/repository';
import { PROGRAM_LABEL, type LegalEntityCode, type ProgramCode, type SchoolYear } from '@/features/price-lists/types';
import type { Result } from '@/lib/tauri/invoke';
import { useAsyncResult } from '@/lib/use-async-result';
import { isRealDate } from '@/lib/validation/formats';
import { bulkItems, bulkRows, lastEntityByChild, programsOf, rowProblems, type BulkRow } from '../bulk-enrolment';
import { suggestedGroup } from '../domain';
import { getFamily, listFamilies, saveEnrolmentsBulk } from '../repository';
import { STATUS_LABEL } from '../types';

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const SELECT = 'h-8 rounded-md border bg-transparent px-1 text-sm';

async function loadRows(schoolYear: SchoolYear): Promise<Result<BulkRow[]>> {
  const [families, invoices] = await Promise.all([listFamilies(), listInvoices({ entity: null, month: null })]);
  if (!families.success) return families;
  if (!invoices.success) return invoices;
  const details = await Promise.all(families.data.map((f) => getFamily(f.id)));
  const failed = details.find((d) => !d.success);
  if (failed && !failed.success) return failed;
  const ok = details.flatMap((d) => (d.success ? [d.data] : []));
  return { success: true, data: bulkRows(ok, schoolYear, lastEntityByChild(invoices.data)) };
}

/**
 * „Dopuna podataka o djeci“ (Director, 2026-11-21; renamed from „Upis djece bez upisa“, which confused): one table for every child without an enrolment in the school year —
 * above all the children imported from the old workbook, which has no program and no date of birth. The institution
 * is suggested from the child's latest invoice; program and date of birth are entered by the operator. Ticked complete
 * rows are saved in one transaction.
 */
export function BulkEnrolmentDialog({
  open,
  onOpenChange,
  schoolYear,
  onSaved,
  entity = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  schoolYear: SchoolYear;
  onSaved: () => void;
  /** Opened in one institution's flow: only its children and those whose institution is not known yet (Director, 2026-11-22). */
  entity?: LegalEntityCode | null;
}): React.JSX.Element {
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Dopuna podataka o djeci — školska ${schoolYear}`}
      description="Za ovu djecu sistem ne zna program (npr. Toddlers / Preschoolers, I–IV) ni datum rođenja, pa im ne može izračunati fakturu. Stari Excel te podatke nema. Dopunite ih ovdje, sve odjednom: ustanova je već predložena, vi birate program i unosite datum rođenja, pa označite dijete i sačuvajte."
      wide
    >
      {open && (
        <Body
          schoolYear={schoolYear}
          entity={entity}
          onSaved={() => {
            onSaved();
            onOpenChange(false);
          }}
        />
      )}
    </FormDialog>
  );
}

function Body({ schoolYear, entity, onSaved }: { schoolYear: SchoolYear; entity: LegalEntityCode | null; onSaved: () => void }): React.JSX.Element {
  const load = useCallback(
    async () => {
      const rows = await loadRows(schoolYear);
      return rows.success && entity ? { ...rows, data: rows.data.filter((r) => r.entity === '' || r.entity === entity) } : rows;
    },
    [schoolYear, entity],
  );
  const rows = useAsyncResult(load);
  if (rows.state.status === 'loading') return <LoadingBlock />;
  if (rows.state.status === 'error') return <ErrorBlock message={rows.state.error} onRetry={rows.reload} />;
  if (rows.state.data.length === 0) return <p className="text-sm text-muted-foreground">Sva djeca imaju upis za {schoolYear}.</p>;
  return <Editor initial={rows.state.data} schoolYear={schoolYear} onSaved={onSaved} />;
}

function Editor({ initial, schoolYear, onSaved }: { initial: BulkRow[]; schoolYear: SchoolYear; onSaved: () => void }): React.JSX.Element {
  const [rows, setRows] = useState(initial);
  const [onlyImported, setOnlyImported] = useState(initial.some((r) => r.child.importReview));
  const [busy, setBusy] = useState(false);
  const now = today();
  const visible = useMemo(() => rows.filter((r) => !onlyImported || r.child.importReview), [rows, onlyImported]);
  const ready = bulkItems(rows, schoolYear, now, () => crypto.randomUUID()).length;
  const set = (childId: string, change: Partial<BulkRow>) => setRows((all) => all.map((r) => (r.child.id === childId ? { ...r, ...change } : r)));

  async function save(): Promise<void> {
    const items = bulkItems(rows, schoolYear, now, () => crypto.randomUUID());
    if (items.length === 0) return;
    setBusy(true);
    try {
      const result = await saveEnrolmentsBulk(items);
      if (result.success) {
        toast.success(`Sačuvano ${result.data} upisa.`);
        onSaved();
      } else toast.error(result.error);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span>
          Bez upisa: <strong>{rows.length}</strong> djece ({rows.filter((r) => r.child.importReview).length} uvezeno iz Excela)
        </span>
        <label className="flex items-center gap-2">
          <input type="checkbox" className="size-4" checked={onlyImported} onChange={(e) => setOnlyImported(e.target.checked)} />
          Samo uvezena djeca
        </label>
      </div>
      <div className="max-h-[55vh] overflow-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8" />
              <TableHead>Dijete</TableHead>
              <TableHead>Ustanova</TableHead>
              <TableHead>Program</TableHead>
              <TableHead>Datum rođenja</TableHead>
              <TableHead>Lice</TableHead>
              <TableHead>Početak</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((row) => {
              const problems = rowProblems(row, schoolYear, now);
              const name = `${row.child.firstName} ${row.child.lastName}`;
              return (
                <TableRow key={row.child.id}>
                  <TableCell>
                    <input
                      type="checkbox"
                      className="size-4"
                      aria-label={`Upiši ${name}`}
                      checked={row.selected}
                      onChange={(e) => set(row.child.id, { selected: e.target.checked })}
                    />
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{name}</div>
                    <div className="text-xs text-muted-foreground">
                      {row.familyName}
                      {row.child.importReview && (
                        <Badge variant="outline" className="ml-1">
                          uvezeno
                        </Badge>
                      )}
                    </div>
                    {row.selected && problems.length > 0 && <div className="text-xs text-destructive">{problems.join(' · ')}</div>}
                  </TableCell>
                  <TableCell>
                    <select
                      aria-label={`Ustanova — ${name}`}
                      className={SELECT}
                      value={row.entity}
                      onChange={(e) => set(row.child.id, { entity: e.target.value as LegalEntityCode | '', program: '' })}
                    >
                      <option value="">—</option>
                      <option value="IMH">IMH</option>
                      <option value="IDSS">IDSS</option>
                    </select>
                    {row.suggestedEntity && <div className="text-xs text-muted-foreground">po zadnjem računu</div>}
                  </TableCell>
                  <TableCell>
                    <select
                      aria-label={`Program — ${name}`}
                      className={SELECT}
                      value={row.program}
                      disabled={!row.entity}
                      onChange={(e) => set(row.child.id, { program: e.target.value as ProgramCode | '' })}
                    >
                      <option value="">— odaberite —</option>
                      {row.entity &&
                        programsOf(row.entity).map((p) => (
                          <option key={p} value={p}>
                            {PROGRAM_LABEL[p]}
                          </option>
                        ))}
                    </select>
                  </TableCell>
                  <TableCell>
                    <Input aria-label={`Datum rođenja — ${name}`} type="date" className="h-8 w-36" value={row.dateOfBirth}
                      onChange={(e) => {
                        const dateOfBirth = e.target.value;
                        // IMH kindergarten: the group is proposed by age on the first day (SPEC A9); the operator may change it
                        const kindergarten = row.entity === 'IMH' && (row.program === '' || row.program === 'TODDLERS' || row.program === 'PRESCHOOLERS');
                        set(row.child.id, kindergarten && isRealDate(dateOfBirth) ? { dateOfBirth, program: suggestedGroup(dateOfBirth, row.startsOn) } : { dateOfBirth });
                      }}
                    />
                  </TableCell>
                  <TableCell>
                    <select
                      aria-label={`Lice — ${name}`}
                      className={SELECT}
                      value={row.residency}
                      onChange={(e) => set(row.child.id, { residency: e.target.value as BulkRow['residency'] })}
                    >
                      <option value="DOMESTIC">domaće</option>
                      <option value="FOREIGN">strano</option>
                    </select>
                  </TableCell>
                  <TableCell>
                    <Input aria-label={`Početak — ${name}`} type="date" className="h-8 w-36" value={row.startsOn} onChange={(e) => set(row.child.id, { startsOn: e.target.value })} />
                  </TableCell>
                  <TableCell>
                    <select
                      aria-label={`Status — ${name}`}
                      className={SELECT}
                      value={row.status}
                      onChange={(e) => set(row.child.id, { status: e.target.value as BulkRow['status'] })}
                    >
                      <option value="ACTIVE">{STATUS_LABEL.ACTIVE}</option>
                      <option value="AWAITING_ENROLMENT_PAYMENT">{STATUS_LABEL.AWAITING_ENROLMENT_PAYMENT}</option>
                    </select>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        Djecu koja više ne pohađaju ustanovu ne označavajte. Upis se kasnije mijenja u kartici porodice.
      </p>
      <div>
        <Button disabled={busy || ready === 0} onClick={() => void save()}>
          <SaveIcon aria-hidden /> {busy ? 'Spremam…' : `Sačuvaj ${ready} upisa`}
        </Button>
      </div>
    </div>
  );
}
