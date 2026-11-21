import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';

/** Modal wrapper for forms: Esc and focus trapping come from the Radix dialog (accessibility). */
export function FormDialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  wide = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  wide?: boolean;
}): React.JSX.Element {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* wide dialogs use almost the whole window on every screen; on a phone every dialog is full width */}
      <DialogContent
        className={
          wide
            ? 'max-h-[94dvh] w-[calc(100vw-1rem)] max-w-none overflow-y-auto sm:max-w-[min(96vw,96rem)]'
            : 'max-h-[94dvh] w-[calc(100vw-1rem)] overflow-y-auto sm:max-w-2xl'
        }
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}
