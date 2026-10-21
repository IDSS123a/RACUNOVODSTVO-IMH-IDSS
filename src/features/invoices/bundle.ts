import { zipSync } from 'fflate';

/**
 * Packaging of invoice PDFs (BR-28, BR-31, DL-P006): a .zip, and an Outlook draft (.eml) with
 * every PDF and the .zip attached. Pure functions — no I/O; the application layer saves/opens the result.
 */

export interface NamedFile {
  readonly name: string;
  readonly bytes: Uint8Array;
}

/** One .zip with all files (names must be unique). */
export function zipFiles(files: ReadonlyArray<NamedFile>): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) {
    if (entries[file.name]) throw new Error(`duplicate file name ${file.name}`);
    entries[file.name] = file.bytes;
  }
  // PDFs are already compressed; level 1 keeps zipping fast without growing the archive.
  return zipSync(entries, { level: 1 });
}

const BASE64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Standard base64 (no line breaks). */
export function base64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i] ?? 0;
    const b = bytes[i + 1] ?? 0;
    const c = bytes[i + 2] ?? 0;
    const n = (a << 16) | (b << 8) | c;
    out += BASE64[(n >> 18) & 63];
    out += BASE64[(n >> 12) & 63];
    out += i + 1 < bytes.length ? BASE64[(n >> 6) & 63] : '=';
    out += i + 2 < bytes.length ? BASE64[n & 63] : '=';
  }
  return out;
}

function wrap76(text: string): string {
  const lines: string[] = [];
  for (let i = 0; i < text.length; i += 76) lines.push(text.slice(i, i + 76));
  return lines.join('\r\n');
}

/** RFC 2047 encoded header word for non-ASCII subjects. */
function encodeHeader(value: string): string {
  return /^[\x20-\x7e]*$/.test(value) ? value : `=?UTF-8?B?${base64(new TextEncoder().encode(value))}?=`;
}

const MIME_TYPE: Readonly<Record<string, string>> = { pdf: 'application/pdf', zip: 'application/zip' };

export interface MailDraft {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  readonly attachments: ReadonlyArray<NamedFile>;
}

/**
 * An unsent e-mail (.eml with `X-Unsent: 1`): classic Outlook opens it as an editable draft.
 * There is no From header — Outlook uses the operator's own account.
 */
export function buildEml(draft: MailDraft, boundary: string): string {
  if (!/^[\w.+-]+@[\w-]+(\.[\w-]+)+$/.test(draft.to)) throw new Error(`invalid recipient ${draft.to}`);
  const parts: string[] = [
    'X-Unsent: 1',
    `To: ${draft.to}`,
    `Subject: ${encodeHeader(draft.subject)}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap76(base64(new TextEncoder().encode(draft.body.replace(/\r?\n/g, '\r\n')))),
  ];
  for (const file of draft.attachments) {
    if (!/^[\w.-]+$/.test(file.name)) throw new Error(`unsafe attachment name ${file.name}`);
    const type = MIME_TYPE[file.name.split('.').pop() ?? ''] ?? 'application/octet-stream';
    parts.push(
      `--${boundary}`,
      `Content-Type: ${type}; name="${file.name}"`,
      `Content-Disposition: attachment; filename="${file.name}"`,
      'Content-Transfer-Encoding: base64',
      '',
      wrap76(base64(file.bytes)),
    );
  }
  parts.push(`--${boundary}--`, '');
  return parts.join('\r\n');
}

/**
 * Split items into consecutive groups whose total size stays under the limit
 * (an item larger than the limit gets a group of its own).
 */
export function chunkBySize<T>(items: ReadonlyArray<T>, sizeOf: (item: T) => number, limit: number): T[][] {
  const groups: T[][] = [];
  let current: T[] = [];
  let size = 0;
  for (const item of items) {
    const itemSize = sizeOf(item);
    if (current.length > 0 && size + itemSize > limit) {
      groups.push(current);
      current = [];
      size = 0;
    }
    current.push(item);
    size += itemSize;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}
