import { Input } from '@/components/ui/input';
import { UNIT_PROPOSALS } from '../manual';

/**
 * Unit of measure (JM) of a line: the usual units are proposed, any other can be typed (Director, 2026-11-22: „za
 * svako polje šablon, ali i mogućnost da se drugačije unese“). The value is checked by `normalizeUnit`.
 */
export function UnitInput({ id, label = 'JM', value, onChange, className = 'h-9 w-24' }: { id: string; label?: string; value: string; onChange: (value: string) => void; className?: string }): React.JSX.Element {
  const listId = `${id}-units`;
  return (
    <span>
      <Input aria-label={label} list={listId} className={className} placeholder="JM" maxLength={10} value={value} onChange={(e) => onChange(e.target.value)} />
      <datalist id={listId}>
        {UNIT_PROPOSALS.map((u) => (
          <option key={u.unit} value={u.unit}>
            {u.label}
          </option>
        ))}
      </datalist>
    </span>
  );
}
