import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Field } from '@/features/settings/components/OperatorForm';
import type { Residency } from '@/features/price-lists/types';
import { ChildSchema } from '@/lib/validation/schemas';
import type { Child } from '../types';

/**
 * Child form. Date of birth decides the sibling order (discount on the younger child, D11).
 * Residency selects the price column; citizenship and KS residence decide ministry-subsidy eligibility.
 */
export function ChildForm({ child, onSubmit }: { child: Child; onSubmit: (child: Child) => Promise<void> }): React.JSX.Element {
  const form = useForm<Child>({ resolver: zodResolver(ChildSchema), defaultValues: child });
  const { errors, isSubmitting } = form.formState;
  const residency = form.watch('residency');

  return (
    <form className="grid gap-4 sm:grid-cols-2" onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <Field id="child-first" label="Ime" error={errors.firstName?.message}>
        <Input id="child-first" {...form.register('firstName')} aria-invalid={Boolean(errors.firstName)} />
      </Field>
      <Field id="child-last" label="Prezime" error={errors.lastName?.message}>
        <Input id="child-last" {...form.register('lastName')} aria-invalid={Boolean(errors.lastName)} />
      </Field>
      <Field id="child-dob" label="Datum rođenja" error={errors.dateOfBirth?.message}>
        <Input id="child-dob" type="date" {...form.register('dateOfBirth')} aria-invalid={Boolean(errors.dateOfBirth)} />
      </Field>
      <Field id="child-residency" label="Cijena po cjenovniku za">
        <Select value={residency} onValueChange={(value) => form.setValue('residency', value as Residency, { shouldDirty: true })}>
          <SelectTrigger id="child-residency">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="DOMESTIC">Domaća lica</SelectItem>
            <SelectItem value="FOREIGN">Strana lica</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <fieldset className="grid gap-2 sm:col-span-2">
        <legend className="text-sm font-medium">Uslovi za subvenciju Ministarstva (samo vrtić IMH)</legend>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" {...form.register('citizenBih')} /> Državljanin BiH
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" className="size-4" {...form.register('residenceKs')} /> Prebivalište u Kantonu Sarajevo
        </label>
      </fieldset>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Spremanje…' : 'Sačuvaj dijete'}
        </Button>
      </div>
    </form>
  );
}
