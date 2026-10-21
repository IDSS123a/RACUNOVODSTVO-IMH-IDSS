import { useFieldArray, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { PlusIcon, Trash2Icon } from 'lucide-react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Field } from '@/features/settings/components/OperatorForm';
import { FamilySchema, GuardianSchema } from '@/lib/validation/schemas';
import { isValidIban } from '../domain';
import { newGuardian } from '../factories';
import { ROLE_LABEL, type Family, type Guardian, type GuardianRole } from '../types';

const FormSchema = z.object({
  family: FamilySchema,
  guardians: z
    .array(GuardianSchema.refine((g) => isValidIban(g.iban), { message: 'IBAN nije ispravan (BA + 18 cifara)', path: ['iban'] }))
    .min(1, 'dodajte barem jednog roditelja')
    .superRefine((guardians, ctx) => {
      // One mother and one father at most; any further person is a "Staratelj" (Director, 2026-10-21).
      for (const role of ['MOTHER', 'FATHER'] as const) {
        const indexes = guardians.flatMap((g, i) => (g.role === role ? [i] : []));
        for (const index of indexes.slice(1)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [index, 'role'],
            message: role === 'MOTHER' ? 'već postoji majka — odaberite „Staratelj“' : 'već postoji otac — odaberite „Staratelj“',
          });
        }
      }
    }),
});
type FormValues = z.infer<typeof FormSchema>;

/**
 * Family + guardians form. Exactly one guardian is the payer (radio choice);
 * the payer receives invoices, and the IBAN receives ministry subsidy refunds (D5).
 */
export function FamilyForm({
  family,
  guardians,
  onSubmit,
  submitLabel,
}: {
  family: Family;
  guardians: Guardian[];
  onSubmit: (family: Family, guardians: Guardian[]) => Promise<void>;
  submitLabel: string;
}): React.JSX.Element {
  const form = useForm<FormValues>({ resolver: zodResolver(FormSchema), defaultValues: { family, guardians } });
  const list = useFieldArray({ control: form.control, name: 'guardians' });
  const { errors, isSubmitting } = form.formState;
  const values = form.watch('guardians');

  function choosePayer(index: number): void {
    values.forEach((_, i) => form.setValue(`guardians.${i}.isPayer`, i === index, { shouldDirty: true }));
  }

  return (
    <form className="grid gap-5" onSubmit={form.handleSubmit((v) => onSubmit(v.family, v.guardians))} noValidate>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="family-name" label="Porodica (npr. prezime)" error={errors.family?.displayName?.message}>
          <Input id="family-name" {...form.register('family.displayName')} aria-invalid={Boolean(errors.family?.displayName)} />
        </Field>
        <Field id="family-address" label="Adresa (za račune)" error={errors.family?.address?.message}>
          <Input id="family-address" {...form.register('family.address')} />
        </Field>
      </div>

      <fieldset className="grid gap-4">
        <legend className="mb-1 text-sm font-medium">Roditelji / staratelji</legend>
        <p className="text-xs text-muted-foreground">
          „Kupac na računu“ je osoba na koju glasi račun. Uplatu može izvršiti bilo koji član porodice — uplata se uvijek knjiži na račun.
          IBAN je potreban samo za povrat subvencije Ministarstva (vrtić IMH, državljani BiH).
        </p>
        {list.fields.map((field, index) => {
          const e = errors.guardians?.[index];
          return (
            <div key={field.id} className="grid gap-3 rounded-lg border p-4 md:grid-cols-6">
              <Field id={`g-${index}-name`} label="Ime i prezime" error={e?.fullName?.message} className="md:col-span-2">
                <Input id={`g-${index}-name`} {...form.register(`guardians.${index}.fullName`)} aria-invalid={Boolean(e?.fullName)} />
              </Field>
              <Field id={`g-${index}-role`} label="Uloga" error={e?.role?.message}>
                <Select
                  value={values[index]?.role ?? 'MOTHER'}
                  onValueChange={(role) => form.setValue(`guardians.${index}.role`, role as GuardianRole, { shouldDirty: true })}
                >
                  <SelectTrigger id={`g-${index}-role`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(ROLE_LABEL) as GuardianRole[]).map((role) => (
                      <SelectItem key={role} value={role}>
                        {ROLE_LABEL[role]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field id={`g-${index}-email`} label="Email" error={e?.email?.message} className="md:col-span-2">
                <Input id={`g-${index}-email`} type="email" {...form.register(`guardians.${index}.email`)} aria-invalid={Boolean(e?.email)} />
              </Field>
              <Field id={`g-${index}-phone`} label="Telefon">
                <Input id={`g-${index}-phone`} type="tel" {...form.register(`guardians.${index}.phone`)} />
              </Field>
              <Field id={`g-${index}-iban`} label="IBAN za povrat subvencije (nije obavezno)" error={e?.iban?.message} className="md:col-span-3">
                <Input id={`g-${index}-iban`} placeholder="BA39 …" {...form.register(`guardians.${index}.iban`)} aria-invalid={Boolean(e?.iban)} />
              </Field>
              <label className="flex items-center gap-2 self-end pb-2 text-sm md:col-span-2">
                <input type="radio" name="payer" checked={values[index]?.isPayer ?? false} onChange={() => choosePayer(index)} className="size-4" />
                Kupac na računu
              </label>
              <div className="flex items-end justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Ukloni roditelja ${index + 1}`}
                  disabled={list.fields.length === 1}
                  onClick={() => list.remove(index)}
                >
                  <Trash2Icon aria-hidden />
                </Button>
              </div>
            </div>
          );
        })}
        {errors.guardians?.root?.message && <p role="alert" className="text-xs text-destructive">{errors.guardians.root.message}</p>}
        <div>
          <Button type="button" variant="outline" onClick={() => list.append(newGuardian(family.id, false))}>
            <PlusIcon aria-hidden /> Dodaj roditelja
          </Button>
        </div>
      </fieldset>

      <div>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Spremanje…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}
