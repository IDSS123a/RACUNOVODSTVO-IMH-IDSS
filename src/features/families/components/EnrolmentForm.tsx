import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PROGRAM_ENTITY, PROGRAM_LABEL, type ProgramCode, type SchoolYear } from '@/features/price-lists/types';
import { Field } from '@/features/settings/components/OperatorForm';
import { EnrolmentSchema } from '@/lib/validation/schemas';
import { schoolYearBounds } from '../domain';
import type { Enrolment } from '../types';

const PROGRAMS = Object.keys(PROGRAM_LABEL) as ProgramCode[];

/**
 * New enrolment. The program decides the legal entity (BR-1) — shown, never chosen.
 * A new enrolment starts as "Čeka upisne uplate" (BR-9).
 */
export function EnrolmentForm({
  enrolment,
  schoolYears,
  onSubmit,
}: {
  enrolment: Enrolment;
  schoolYears: ReadonlyArray<SchoolYear>;
  onSubmit: (enrolment: Enrolment) => Promise<void>;
}): React.JSX.Element {
  const form = useForm<Enrolment>({ resolver: zodResolver(EnrolmentSchema), defaultValues: enrolment });
  const { errors, isSubmitting } = form.formState;
  const program = form.watch('program');
  const year = form.watch('schoolYear');

  return (
    <form className="grid gap-4 sm:grid-cols-2" onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <Field id="enr-program" label="Program">
        <Select value={program} onValueChange={(value) => form.setValue('program', value as ProgramCode, { shouldDirty: true })}>
          <SelectTrigger id="enr-program">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROGRAMS.map((code) => (
              <SelectItem key={code} value={code}>
                {PROGRAM_LABEL[code]} ({PROGRAM_ENTITY[code]})
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field id="enr-year" label="Školska godina">
        <Select
          value={year}
          onValueChange={(value) => {
            form.setValue('schoolYear', value, { shouldDirty: true });
            form.setValue('startsOn', schoolYearBounds(value as SchoolYear).from, { shouldDirty: true });
          }}
        >
          <SelectTrigger id="enr-year">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {schoolYears.map((schoolYear) => (
              <SelectItem key={schoolYear} value={schoolYear}>
                {schoolYear}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>
      <Field id="enr-start" label="Početak pohađanja" error={errors.startsOn?.message}>
        <Input id="enr-start" type="date" {...form.register('startsOn')} aria-invalid={Boolean(errors.startsOn)} />
      </Field>
      <p className="self-end pb-2 text-sm text-muted-foreground">
        Ustanova: <strong>{PROGRAM_ENTITY[program]}</strong>
      </p>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Spremanje…' : 'Upiši dijete'}
        </Button>
      </div>
    </form>
  );
}
