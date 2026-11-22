import { strToU8, zipSync } from 'fflate';

/**
 * Minimal .xlsx writer (SpreadsheetML in a zip, fflate — no new dependency, M-12). One source for every workbook of
 * the app (M-7): import findings, the invoice register and reports. Text is always an inline string, never a formula
 * (E-4: no formula injection from data).
 */

export type Cell = string | number | null;
export interface Sheet {
  readonly name: string;
  readonly rows: ReadonlyArray<ReadonlyArray<Cell>>;
}

/** XML text without characters XML 1.0 forbids. */
export function xmlText(value: string): string {
  return value
    .split('')
    .filter((ch) => {
      const code = ch.charCodeAt(0);
      return code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 0xfffe && code !== 0xffff);
    })
    .join('')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function columnName(index: number): string {
  let n = index + 1;
  let name = '';
  while (n > 0) {
    const r = (n - 1) % 26;
    name = String.fromCharCode(65 + r) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function sheetXml(rows: ReadonlyArray<ReadonlyArray<Cell>>): string {
  const body = rows
    .map((row, r) => {
      const cells = row
        .map((value, c) => {
          const ref = `${columnName(c)}${r + 1}`;
          if (value === null || value === '') return '';
          if (typeof value === 'number') return `<c r="${ref}"><v>${value}</v></c>`;
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlText(value)}</t></is></c>`;
        })
        .join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`;
}

/** Excel forbids : \ / ? * [ ] in sheet names and allows at most 31 characters; names must be unique. */
export function sheetName(title: string, used: Set<string>): string {
  const base = title.replace(/[:\\/?*[\]]/g, '-').slice(0, 31);
  let name = base;
  for (let n = 2; used.has(name.toLowerCase()); n += 1) name = `${base.slice(0, 31 - String(n).length - 1)} ${n}`;
  used.add(name.toLowerCase());
  return name;
}

/** The bytes of an .xlsx workbook with the given sheets, in order. */
export function buildWorkbook(input: ReadonlyArray<Sheet>): Uint8Array {
  const used = new Set<string>();
  const sheets = input.map((s) => ({ name: sheetName(s.name, used), xml: sheetXml(s.rows) }));
  const ns = 'http://schemas.openxmlformats.org';
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="${ns}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets
        .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
        .join('')}</Types>`,
    ),
    '_rels/.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="rId1" Type="${ns}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    ),
    'xl/workbook.xml': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="${ns}/spreadsheetml/2006/main" xmlns:r="${ns}/officeDocument/2006/relationships"><sheets>${sheets
        .map((s, i) => `<sheet name="${xmlText(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
        .join('')}</sheets></workbook>`,
    ),
    'xl/_rels/workbook.xml.rels': strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="${ns}/package/2006/relationships">${sheets
        .map((_, i) => `<Relationship Id="rId${i + 1}" Type="${ns}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
        .join('')}</Relationships>`,
    ),
  };
  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(s.xml);
  });
  return zipSync(files, { level: 6 });
}
