import { zipSync } from 'fflate';

/**
 * Minimal .docx writer (WordprocessingML in a zip, fflate — no new dependency, M-12). One source for every Word
 * document of the app (M-7): invoices and reports.
 */

const encoder = new TextEncoder();

function esc(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function run(text: string, options: { bold?: boolean; size?: number } = {}): string {
  const props = `${options.bold ? '<w:b/>' : ''}${options.size ? `<w:sz w:val="${options.size * 2}"/>` : ''}`;
  return `<w:r>${props ? `<w:rPr>${props}</w:rPr>` : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;
}

export function para(text: string, options: { bold?: boolean; size?: number; align?: 'left' | 'right' | 'center' } = {}): string {
  const align = options.align && options.align !== 'left' ? `<w:pPr><w:jc w:val="${options.align === 'right' ? 'end' : 'center'}"/></w:pPr>` : '';
  return `<w:p>${align}${run(text, options)}</w:p>`;
}

function cell(text: string, width: number, options: { bold?: boolean; align?: 'left' | 'right' | 'center'; shade?: boolean } = {}): string {
  const shade = options.shade ? '<w:shd w:val="clear" w:color="auto" w:fill="E7EBF0"/>' : '';
  return `<w:tc><w:tcPr><w:tcW w:w="${width}" w:type="dxa"/>${shade}</w:tcPr>${para(text, { bold: options.bold, size: 9, align: options.align })}</w:tc>`;
}

/** A bordered table; `header` makes the first row bold and shaded; `right` lists right-aligned (amount) columns. */
export function table(widths: ReadonlyArray<number>, rows: ReadonlyArray<ReadonlyArray<string>>, options: { header?: boolean; right?: ReadonlyArray<number> } = {}): string {
  const borders = '<w:tblBorders>' + ['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map((b) => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="A0A8B4"/>`).join('') + '</w:tblBorders>';
  const grid = `<w:tblGrid>${widths.map((w) => `<w:gridCol w:w="${w}"/>`).join('')}</w:tblGrid>`;
  const body = rows
    .map((row, r) => `<w:tr>${row.map((text, c) => cell(text, widths[c] ?? 1000, { bold: options.header && r === 0, shade: options.header && r === 0, align: options.right?.includes(c) ? 'right' : 'left' })).join('')}</w:tr>`)
    .join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="${widths.reduce((a, b) => a + b, 0)}" w:type="dxa"/>${borders}</w:tblPr>${grid}${body}</w:tbl>`;
}

/** The document.xml of an A4 document with the given body parts. */
export function documentXml(parts: ReadonlyArray<string>, landscape = false): string {
  const size = landscape ? '<w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/>' : '<w:pgSz w:w="11906" w:h="16838"/>';
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    parts.join('') +
    `<w:sectPr>${size}<w:pgMar w:top="850" w:right="850" w:bottom="850" w:left="850" w:header="0" w:footer="0" w:gutter="0"/></w:sectPr>` +
    '</w:body></w:document>'
  );
}

/** A complete .docx file from its document.xml. */
export function wordPackage(document: string): Uint8Array {
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': encoder.encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
    ),
    '_rels/.rels': encoder.encode(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
    ),
    'word/document.xml': encoder.encode(document),
  };
  return zipSync(files, { level: 6 });
}
