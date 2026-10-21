import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { InstitutionSchema } from '@/lib/validation/schemas';
import { saveInstitution, type Institution } from '../repository';
import { Field } from './OperatorForm';

const FIELDS: ReadonlyArray<{ name: keyof Omit<Institution, 'code'>; label: string; wide?: boolean }> = [
  { name: 'fullName', label: 'Puni naziv (kao u memorandumu)', wide: true },
  { name: 'shortName', label: 'Skraćeni naziv' },
  { name: 'address', label: 'Adresa' },
  { name: 'phone', label: 'Telefon' },
  { name: 'fax', label: 'Fax' },
  { name: 'mobile', label: 'Mobitel' },
  { name: 'email', label: 'Email' },
  { name: 'website', label: 'Web' },
  { name: 'taxId', label: 'ID broj' },
  { name: 'registrationNumber', label: 'Registarski broj' },
  { name: 'bankName', label: 'Banka' },
  { name: 'bankAccount', label: 'Broj računa' },
  { name: 'iban', label: 'IBAN' },
  { name: 'swift', label: 'SWIFT (BIC)' },
  { name: 'invoiceNote', label: 'Napomena na računu (npr. PDV napomena) — tačan tekst unosi ustanova', wide: true },
];

/** Edit institution master data (BR-2). Saved to the encrypted database and audited. */
export function InstitutionForm({ institution, onSaved }: { institution: Institution; onSaved: () => void }): React.JSX.Element {
  const form = useForm<Institution>({ resolver: zodResolver(InstitutionSchema), defaultValues: institution });
  const { errors, isSubmitting, isDirty } = form.formState;

  async function submit(values: Institution): Promise<void> {
    const result = await saveInstitution(values);
    if (result.success) {
      toast.success(`Podaci ustanove ${values.code} su sačuvani.`);
      form.reset(values);
      onSaved();
    } else {
      toast.error(result.error);
    }
  }

  return (
    <form className="grid gap-4 md:grid-cols-2" onSubmit={form.handleSubmit(submit)} noValidate>
      {FIELDS.map((field) => {
        const id = `inst-${institution.code}-${field.name}`;
        return (
          <Field key={field.name} id={id} label={field.label} error={errors[field.name]?.message} className={field.wide ? 'md:col-span-2' : ''}>
            <Input id={id} {...form.register(field.name)} aria-invalid={Boolean(errors[field.name])} />
          </Field>
        );
      })}
      <div className="md:col-span-2">
        <Button type="submit" disabled={isSubmitting || !isDirty}>
          {isSubmitting ? 'Spremanje…' : 'Sačuvaj podatke ustanove'}
        </Button>
      </div>
    </form>
  );
}
