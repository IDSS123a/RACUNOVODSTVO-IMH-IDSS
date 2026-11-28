import { Input } from '@/components/ui/input';
import { PAYER_RELATIONS } from '../text-templates';

/** The relation field: suggestions from PAYER_RELATIONS, any other relation may be typed. */
export function PayerRelationInput({
  id,
  value,
  onChange,
  invalid,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
}): React.JSX.Element {
  return (
    <>
      <Input id={id} list={`${id}-list`} value={value} onChange={(e) => onChange(e.target.value)} aria-invalid={invalid} placeholder="npr. baka" />
      <datalist id={`${id}-list`}>
        {PAYER_RELATIONS.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
    </>
  );
}
