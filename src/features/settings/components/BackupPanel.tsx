import { useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { FolderOpenIcon, HardDriveDownloadIcon, RotateCcwIcon } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { formatBytes, formatDateTime } from '@/lib/format';
import { createBackup, restoreBackup, saveSettings, type Settings } from '../repository';
import { Field } from './OperatorForm';

/**
 * Encrypted backups (DL-P004): choose a folder, create a backup, restore one.
 * Restore replaces all data, so it requires an explicit confirmation dialog.
 */
export function BackupPanel({ settings, onSettingsSaved }: { settings: Settings; onSettingsSaved: () => void }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const [restoreFile, setRestoreFile] = useState<string | null>(null);
  const [recoveryKey, setRecoveryKey] = useState('');

  async function chooseFolder(): Promise<void> {
    const folder = await open({ directory: true, multiple: false, title: 'Folder za rezervne kopije' });
    if (typeof folder !== 'string') return;
    const result = await saveSettings({ ...settings, backupFolder: folder });
    if (result.success) {
      toast.success('Folder za rezervne kopije je sačuvan.');
      onSettingsSaved();
    } else toast.error(result.error);
  }

  async function backupNow(): Promise<void> {
    if (!settings.backupFolder) return;
    setBusy(true);
    try {
      const result = await createBackup(settings.backupFolder);
      if (result.success) {
        toast.success(`Šifrovana kopija je napravljena (${formatBytes(result.data.bytes)}, ${formatDateTime(result.data.createdAt)}).`);
      } else toast.error(result.error);
    } finally {
      setBusy(false);
    }
  }

  async function chooseRestoreFile(): Promise<void> {
    const file = await open({
      directory: false,
      multiple: false,
      title: 'Odaberite rezervnu kopiju',
      filters: [{ name: 'Rezervna kopija', extensions: ['fkbak'] }],
    });
    if (typeof file === 'string') setRestoreFile(file);
  }

  async function confirmRestore(): Promise<void> {
    if (!restoreFile) return;
    setBusy(true);
    try {
      const result = await restoreBackup(restoreFile, recoveryKey.trim() === '' ? null : recoveryKey.trim());
      if (result.success) {
        toast.success('Podaci su vraćeni iz rezervne kopije. Aplikacija se ponovo učitava.');
        window.setTimeout(() => window.location.reload(), 800);
      } else toast.error(result.error);
    } finally {
      setBusy(false);
      setRestoreFile(null);
      setRecoveryKey('');
    }
  }

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end gap-3">
        <Field id="backup-folder" label="Folder za rezervne kopije" className="min-w-80 flex-1">
          <Input id="backup-folder" readOnly value={settings.backupFolder} placeholder="Nije odabran" />
        </Field>
        <Button variant="outline" onClick={() => void chooseFolder()}>
          <FolderOpenIcon aria-hidden /> Odaberi folder
        </Button>
        <Button disabled={!settings.backupFolder || busy} onClick={() => void backupNow()}>
          <HardDriveDownloadIcon aria-hidden /> {busy ? 'Pravim kopiju…' : 'Napravi rezervnu kopiju'}
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Kopije su šifrovane. Preporuka: folder na mrežnom disku ili OneDrive, kopija na kraju svakog radnog dana.
      </p>
      <div>
        <Button variant="outline" onClick={() => void chooseRestoreFile()}>
          <RotateCcwIcon aria-hidden /> Vrati iz rezervne kopije…
        </Button>
      </div>

      <Dialog open={restoreFile !== null} onOpenChange={(isOpen) => !isOpen && setRestoreFile(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Vratiti podatke iz rezervne kopije?</DialogTitle>
            <DialogDescription>
              Svi trenutni podaci bit će zamijenjeni podacima iz kopije. Trenutna baza se prije toga sprema kao
              „before-restore“.
            </DialogDescription>
          </DialogHeader>
          <p className="break-all text-sm">{restoreFile}</p>
          <Field id="restore-key" label="Ključ za oporavak (samo za kopiju s drugog računara)">
            <Input id="restore-key" value={recoveryKey} onChange={(event) => setRecoveryKey(event.target.value)} autoComplete="off" />
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Odustani</Button>
            </DialogClose>
            <Button variant="destructive" disabled={busy} onClick={() => void confirmRestore()}>
              {busy ? 'Vraćam…' : 'Zamijeni podatke'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
