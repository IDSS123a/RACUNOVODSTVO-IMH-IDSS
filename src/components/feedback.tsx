import { AlertTriangleIcon, Loader2Icon } from 'lucide-react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

/** Shared loading indicator (DONE_CHECKLIST: every async action shows a loading state). */
export function LoadingBlock({ label = 'Učitavanje…' }: { label?: string }): React.JSX.Element {
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
      <Loader2Icon className="size-4 animate-spin" aria-hidden />
      {label}
    </div>
  );
}

/** Shared error block with a recovery action (DONE_CHECKLIST: friendly message + recovery). */
export function ErrorBlock({
  title = 'Nešto nije u redu',
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}): React.JSX.Element {
  return (
    <Alert variant="destructive" className="m-4">
      <AlertTriangleIcon aria-hidden />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p>{message}</p>
        {onRetry && (
          <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
            Pokušaj ponovo
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

/** Designed empty state (no blank screens). */
export function EmptyBlock({ message }: { message: string }): React.JSX.Element {
  return <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{message}</p>;
}
