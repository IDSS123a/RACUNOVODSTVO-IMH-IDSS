import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { FORMAT } from '@/lib/validation/formats';
import { OperatorFormSchema, OperatorSchema } from '@/lib/validation/schemas';

export type OperatorValues = z.infer<typeof OperatorSchema>;

const EMPTY: OperatorValues = { fullName: '', jobTitle: '', email: '', phone: '' };

/**
 * Operator profile form (DL-P002). The values are stored only in the encrypted
 * database (BR-22) and printed as "Fakturisao/la" on invoices.
 */
export function OperatorForm({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial: OperatorValues | null;
  submitLabel: string;
  onSubmit: (values: OperatorValues) => Promise<void>;
}): React.JSX.Element {
  const form = useForm<OperatorValues>({ resolver: zodResolver(OperatorFormSchema), defaultValues: initial ?? EMPTY });
  const { errors, isSubmitting } = form.formState;

  return (
    <form className="grid gap-4 sm:grid-cols-2" onSubmit={form.handleSubmit(onSubmit)} noValidate>
      <Field id="op-name" label="Ime i prezime" hint={FORMAT.fullName} error={errors.fullName?.message}>
        <Input id="op-name" autoComplete="name" {...form.register('fullName')} aria-invalid={Boolean(errors.fullName)} />
      </Field>
      <Field id="op-title" label="Funkcija" error={errors.jobTitle?.message}>
        <Input id="op-title" {...form.register('jobTitle')} aria-invalid={Boolean(errors.jobTitle)} />
      </Field>
      <Field id="op-email" label="Email" hint={FORMAT.email} error={errors.email?.message}>
        <Input id="op-email" type="email" autoComplete="email" {...form.register('email')} aria-invalid={Boolean(errors.email)} />
      </Field>
      <Field id="op-phone" label="Telefon" hint={FORMAT.phone} error={errors.phone?.message}>
        <Input id="op-phone" type="tel" autoComplete="tel" {...form.register('phone')} aria-invalid={Boolean(errors.phone)} />
      </Field>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Spremanje…' : submitLabel}
        </Button>
      </div>
    </form>
  );
}

/** Label + control + error message (or the allowed format, DL-P017), wired for screen readers. */
export function Field({
  id,
  label,
  error,
  hint,
  corrected,
  children,
  className,
}: {
  id: string;
  label: string;
  error?: string | undefined;
  /** The allowed format, shown while there is no error. */
  hint?: string | undefined;
  /** What the value will be saved as, when it differs from what was typed (SPEC registration-validation A7). */
  corrected?: string | null | undefined;
  children: React.ReactNode;
  className?: string;
}): React.JSX.Element {
  return (
    <div className={`grid gap-1.5 ${className ?? ''}`}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : (
        <>
          {corrected && (
            <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
              Ispravljeno — biće spremljeno kao: „{corrected}“
            </p>
          )}
          {hint && <p className="text-xs text-muted-foreground">Format: {hint}</p>}
        </>
      )}
    </div>
  );
}
