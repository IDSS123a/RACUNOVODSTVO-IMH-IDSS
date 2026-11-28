import { useCallback, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { DuplicateMatch } from '../duplicates';

export type DuplicateAnswer = { readonly kind: 'save' } | { readonly kind: 'back' } | { readonly kind: 'open'; readonly familyId: string };

/**
 * „Možda već postoji“ (SPEC registration-validation §B): the possible duplicates with their reasons; the operator
 * opens the existing family, saves anyway („Ipak je drugi zapis“) or goes back. Nothing is merged automatically.
 */
export function useDuplicateGuard(): [React.JSX.Element, (matches: ReadonlyArray<DuplicateMatch>, what: string) => Promise<DuplicateAnswer>] {
  const [state, setState] = useState<{ matches: ReadonlyArray<DuplicateMatch>; what: string } | null>(null);
  const resolver = useRef<((answer: DuplicateAnswer) => void) | null>(null);

  const ask = useCallback((matches: ReadonlyArray<DuplicateMatch>, what: string) => {
    setState({ matches, what });
    return new Promise<DuplicateAnswer>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const answer = (value: DuplicateAnswer) => {
    resolver.current?.(value);
    resolver.current = null;
    setState(null);
  };

  const element = (
    <Dialog open={state !== null} onOpenChange={(open) => !open && answer({ kind: 'back' })}>
      <DialogContent className="w-[calc(100vw-1rem)] sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Možda već postoji</DialogTitle>
          <DialogDescription>
            {state?.what} liči na postojeći zapis. Dupli zapis vodi do duplih računa — provjerite prije spremanja.
          </DialogDescription>
        </DialogHeader>
        <ul className="grid gap-2 text-sm">
          {state?.matches.map((m) => (
            <li key={m.familyId} className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-2">
              <span>
                Porodica <strong>{m.familyName}</strong>: {m.reasons.join(', ')}
              </span>
              <Button size="sm" variant="outline" onClick={() => answer({ kind: 'open', familyId: m.familyId })}>
                Otvori postojeću
              </Button>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <Button variant="outline" autoFocus onClick={() => answer({ kind: 'back' })}>
            Nazad
          </Button>
          <Button onClick={() => answer({ kind: 'save' })}>Ipak je drugi zapis — spremi</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
  return [element, ask];
}
