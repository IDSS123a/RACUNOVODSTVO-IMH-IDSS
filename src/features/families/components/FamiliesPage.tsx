import { useCallback, useMemo, useState } from 'react';
import { PlusIcon, SearchIcon } from 'lucide-react';
import { toast } from 'sonner';
import { EmptyBlock, ErrorBlock, LoadingBlock } from '@/components/feedback';
import { FormDialog } from '@/components/form-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import type { SchoolYear } from '@/features/price-lists/types';
import { useAsyncResult } from '@/lib/use-async-result';
import { saveFamilyWithGuardians } from '../actions';
import { listFamilies } from '../repository';
import type { Family } from '../types';
import { FamilyDetailView } from './FamilyDetailView';
import { newGuardian } from '../factories';
import { FamilyForm } from './FamilyForm';

/** Families list with search; opens the family detail view. */
export function FamiliesPage({ defaultYear }: { defaultYear: SchoolYear }): React.JSX.Element {
  const loadFamilies = useCallback(() => listFamilies(), []);
  const families = useAsyncResult(loadFamilies);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState<Family | null>(null);

  const visible = useMemo(() => {
    if (families.state.status !== 'ready') return [];
    const needle = query.trim().toLocaleLowerCase('bs');
    return families.state.data.filter(
      (f) => needle === '' || f.displayName.toLocaleLowerCase('bs').includes(needle) || (f.payerName ?? '').toLocaleLowerCase('bs').includes(needle),
    );
  }, [families.state, query]);

  if (selected) {
    return (
      <FamilyDetailView
        familyId={selected}
        defaultYear={defaultYear}
        onBack={() => {
          setSelected(null);
          families.reload();
        }}
      />
    );
  }

  return (
    <div className="grid gap-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Porodice</h1>
          <p className="text-sm text-muted-foreground">Roditelji, djeca i upisi u IMH i IDSS.</p>
        </div>
        <Button onClick={() => setCreating({ id: crypto.randomUUID(), displayName: '', address: '' })}>
          <PlusIcon aria-hidden /> Nova porodica
        </Button>
      </header>

      <div className="relative max-w-sm">
        <SearchIcon className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
        <Input aria-label="Pretraga porodica" placeholder="Traži po porodici ili platiocu…" className="pl-8" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      {families.state.status === 'loading' && <LoadingBlock />}
      {families.state.status === 'error' && <ErrorBlock message={families.state.error} onRetry={families.reload} />}
      {families.state.status === 'ready' && visible.length === 0 && (
        <EmptyBlock message={families.state.data.length === 0 ? 'Još nema porodica. Dodajte prvu porodicu.' : 'Nijedna porodica ne odgovara pretrazi.'} />
      )}
      {visible.length > 0 && (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Porodica</TableHead>
              <TableHead>Platilac</TableHead>
              <TableHead className="text-right">Djece</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((family) => (
              <TableRow key={family.id} className="cursor-pointer" onClick={() => setSelected(family.id)}>
                <TableCell className="font-medium">
                  <button type="button" className="text-left hover:underline" onClick={() => setSelected(family.id)}>
                    {family.displayName}
                  </button>
                </TableCell>
                <TableCell>{family.payerName ?? '—'}</TableCell>
                <TableCell className="text-right tabular-nums">{family.childCount}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <FormDialog open={creating !== null} onOpenChange={(open) => !open && setCreating(null)} title="Nova porodica" wide>
        {creating && (
          <FamilyForm
            family={creating}
            guardians={[newGuardian(creating.id, true)]}
            submitLabel="Sačuvaj porodicu"
            onSubmit={async (family, guardians) => {
              const result = await saveFamilyWithGuardians(family, guardians);
              if (!result.success) return void toast.error(result.error);
              toast.success('Porodica je sačuvana. Dodajte djecu.');
              setCreating(null);
              setSelected(family.id);
            }}
          />
        )}
      </FormDialog>
    </div>
  );
}
