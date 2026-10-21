import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DownloadIcon, PrinterIcon } from 'lucide-react';
import { toast } from 'sonner';
import { ErrorBlock, LoadingBlock } from '@/components/feedback';
import { FormDialog } from '@/components/form-dialog';
import { Button } from '@/components/ui/button';
import { useAsyncResult } from '@/lib/use-async-result';
import type { InvoicePdf } from '../pdf-actions';

// WHY dynamic: pdf-lib, fontkit and the embedded fonts/logos load only when a PDF is opened.
const pdfActions = () => import('../pdf-actions');

/** Invoice PDF preview with print and save. The PDF is the same file that is saved, mailed and zipped. */
export function InvoicePdfDialog({ invoiceId, onClose }: { invoiceId: string | null; onClose: () => void }): React.JSX.Element {
  return (
    <FormDialog open={invoiceId !== null} onOpenChange={(open) => !open && onClose()} title="Račun — PDF" wide>
      {invoiceId && <PdfBody invoiceId={invoiceId} />}
    </FormDialog>
  );
}

function PdfBody({ invoiceId }: { invoiceId: string }): React.JSX.Element {
  const load = useCallback(() => pdfActions().then((m) => m.buildInvoicePdf(invoiceId)), [invoiceId]);
  const pdf = useAsyncResult(load);
  if (pdf.state.status === 'loading') return <LoadingBlock />;
  if (pdf.state.status === 'error') return <ErrorBlock message={pdf.state.error} onRetry={pdf.reload} />;
  return <PdfPreview pdf={pdf.state.data} />;
}

function PdfPreview({ pdf }: { pdf: InvoicePdf }): React.JSX.Element {
  const frame = useRef<HTMLIFrameElement>(null);
  const [saving, setSaving] = useState(false);
  const url = useMemo(() => URL.createObjectURL(new Blob([pdf.bytes as BlobPart], { type: 'application/pdf' })), [pdf]);
  useEffect(() => () => URL.revokeObjectURL(url), [url]);

  function print(): void {
    try {
      frame.current?.contentWindow?.focus();
      frame.current?.contentWindow?.print();
    } catch {
      toast.info('Koristite dugme za štampu u pregledu PDF-a (gore desno).');
    }
  }

  async function saveFile(): Promise<void> {
    setSaving(true);
    try {
      const result = await (await pdfActions()).saveDocument(pdf.bytes, pdf.fileName, pdf.number);
      if (!result.success) toast.error(result.error);
      else if (result.data) toast.success(`Sačuvano: ${result.data}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        <Button onClick={print}>
          <PrinterIcon aria-hidden /> Štampaj
        </Button>
        <Button variant="outline" disabled={saving} onClick={() => void saveFile()}>
          <DownloadIcon aria-hidden /> {saving ? 'Spremanje…' : 'Sačuvaj PDF'}
        </Button>
      </div>
      <iframe ref={frame} title={`Račun ${pdf.number}`} src={url} className="h-[70vh] w-full rounded-md border bg-white" />
    </div>
  );
}
