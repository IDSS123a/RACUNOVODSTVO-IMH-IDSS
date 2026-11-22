import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';

/**
 * Official documents on the institution's letterhead (Director, 2026-11-21: „Izvještaji su zvanični dokumenti i moraju
 * biti na pripadajućim memorandumima“). The letterhead is the institution's own Word template (.dotx: logo in the
 * header, institution data in the footer). The body of the template — a sample letter — is replaced by the document's
 * content; the section properties that reference the header and footer, the styles and the images stay as they are.
 */

const TEMPLATE_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.template.main+xml';
const DOCUMENT_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml';

export class LetterheadError extends Error {}

/**
 * A .docx on the letterhead.
 * @param template the institution's .dotx
 * @param parts WordprocessingML body parts (paragraphs, tables) — see `@/lib/export/docx`
 */
export function onLetterhead(template: Uint8Array, parts: ReadonlyArray<string>): Uint8Array {
  const files = unzipSync(template);
  const documentBytes = files['word/document.xml'];
  const typesBytes = files['[Content_Types].xml'];
  if (!documentBytes || !typesBytes) throw new LetterheadError('memorandum nije ispravan Word šablon');
  const document = strFromU8(documentBytes);
  const bodyOpen = document.indexOf('<w:body>');
  const sectionStart = document.lastIndexOf('<w:sectPr');
  if (bodyOpen < 0 || sectionStart < bodyOpen) throw new LetterheadError('memorandum nema tijelo dokumenta');
  // everything of the template's body except its last section properties (header/footer references, margins) goes
  const section = toA4(document.slice(sectionStart));
  const body = fitTables(parts.join(''), textWidth(section));
  files['word/document.xml'] = strToU8(document.slice(0, bodyOpen + '<w:body>'.length) + body + section);
  // a template becomes a document, so Word opens it as a finished file and not as „new from template“
  files['[Content_Types].xml'] = strToU8(strFromU8(typesBytes).replace(TEMPLATE_TYPE, DOCUMENT_TYPE));
  return zipSync(files, { level: 6 });
}

/** A4 portrait in twips (210 × 297 mm). */
export const A4 = { width: 11906, height: 16838 } as const;

/**
 * Every official document is A4 (Director, 2026-11-22: „Izvještaji moraju biti na A4 formatu“) whatever paper size
 * the letterhead template was saved with (the IMH template is US Letter). Margins, header and footer stay as they are.
 */
export function toA4(section: string): string {
  const size = `<w:pgSz w:w="${A4.width}" w:h="${A4.height}"/>`;
  return /<w:pgSz\b[^>]*\/>/.test(section) ? section.replace(/<w:pgSz\b[^>]*\/>/, size) : section.replace(/<w:pgMar\b/, `${size}<w:pgMar`);
}

/** Width of the text area of a section in twips: page width minus the left and right margins. */
export function textWidth(section: string): number | null {
  const page = /<w:pgSz[^>]*w:w="(\d+)"/.exec(section);
  const left = /<w:pgMar[^>]*w:left="(\d+)"/.exec(section);
  const right = /<w:pgMar[^>]*w:right="(\d+)"/.exec(section);
  if (!page?.[1] || !left?.[1] || !right?.[1]) return null;
  return Number(page[1]) - Number(left[1]) - Number(right[1]);
}

/** Tables wider than the letterhead's text area are scaled down to it, so nothing reaches into the margin. */
export function fitTables(body: string, width: number | null): string {
  if (width === null) return body;
  return body.replace(/<w:tbl>[\s\S]*?<\/w:tbl>/g, (tbl) => {
    const total = Number(/<w:tblW w:w="(\d+)"/.exec(tbl)?.[1] ?? 0);
    if (total <= width) return tbl;
    const factor = width / total;
    return tbl.replace(/(<w:(?:tblW|gridCol|tcW) w:w=")(\d+)"/g, (_, head: string, value: string) => `${head}${Math.floor(Number(value) * factor)}"`);
  });
}

/** Bytes of a data URL (assets inlined at build time: no network, no CSP change). */
export function dataUrlBytes(dataUrl: string): Uint8Array {
  const binary = atob(dataUrl.slice(dataUrl.indexOf(',') + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
