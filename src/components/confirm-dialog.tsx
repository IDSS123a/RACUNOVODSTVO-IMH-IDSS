import { useCallback, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export interface ConfirmOptions {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
  /** Red button for an action that cannot be undone. */
  readonly destructive?: boolean;
}

/**
 * Ask before an action that cannot be undone (deleting, issuing, reversing). Returns the dialog element to render and
 * `confirm(options)`, which resolves to true only when the operator presses the confirm button.
 */
export function useConfirm(): [React.JSX.Element, (options: ConfirmOptions) => Promise<boolean>] {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const resolver = useRef<((answer: boolean) => void) | null>(null);

  const confirm = useCallback((next: ConfirmOptions) => {
    setOptions(next);
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve;
    });
  }, []);

  const answer = (value: boolean) => {
    resolver.current?.(value);
    resolver.current = null;
    setOptions(null);
  };

  const element = (
    <Dialog open={options !== null} onOpenChange={(open) => !open && answer(false)}>
      <DialogContent className="w-[calc(100vw-1rem)] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{options?.title}</DialogTitle>
          <DialogDescription>{options?.message}</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => answer(false)}>
            Odustani
          </Button>
          <Button variant={options?.destructive ? 'destructive' : 'default'} autoFocus onClick={() => answer(true)}>
            {options?.confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
  return [element, confirm];
}
