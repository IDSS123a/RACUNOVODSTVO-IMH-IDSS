import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { para } from './docx';
import { LetterheadError, onLetterhead } from './letterhead';

const letterhead = (code: 'imh' | 'idss') => new Uint8Array(readFileSync(resolve(__dirname, `../../assets/letterheads/${code}.dotx`)));

describe('documents on the institution letterhead', () => {
  for (const code of ['imh', 'idss'] as const) {
    it(`${code.toUpperCase()}: the sample body is replaced, header/footer/images stay, the file is a document`, () => {
      const files = unzipSync(onLetterhead(letterhead(code), [para('Sadržaj izvještaja')]));
      const xml = strFromU8(files['word/document.xml'] ?? new Uint8Array());
      expect(xml).toContain('Sadržaj izvještaja');
      expect(xml).not.toContain('Dostaviti'); // the IMH template's sample letter is gone
      expect(xml).toContain('<w:headerReference');
      expect(xml).toContain('<w:footerReference');
      expect(Object.keys(files).some((f) => f.startsWith('word/media/'))).toBe(true);
      const types = strFromU8(files['[Content_Types].xml'] ?? new Uint8Array());
      expect(types).toContain('wordprocessingml.document.main+xml');
      expect(types).not.toContain('wordprocessingml.template.main+xml');
    });

    it(`${code.toUpperCase()}: the bundled letterhead carries no person's name in any part, images included (BR-22)`, () => {
      const files = unzipSync(letterhead(code));
      const core = strFromU8(files['docProps/core.xml'] ?? new Uint8Array());
      expect(core).toContain(`<dc:creator>${code.toUpperCase()}</dc:creator>`);
      // every author field of every part — Word properties AND the XMP metadata of embedded images (2026-11-27: the
      // IDSS logo carried its author's name in <pdf:Author>) — names only the institution, or nothing
      const AUTHOR = /<(?:dc:creator|cp:lastModifiedBy|pdf:Author|xmp:CreatorTool|photoshop:AuthorsPosition|dc:rights)[^>]*>([\s\S]*?)<\//g;
      for (const [name, bytes] of Object.entries(files)) {
        const text = strFromU8(bytes, true);
        for (const match of text.matchAll(AUTHOR)) {
          const value = (match[1] ?? '').replace(/<[^>]+>/g, '').trim();
          expect(['', 'IMH', 'IDSS'], `${name}: ${match[0].slice(0, 20)}`).toContain(value);
        }
        // PNG text chunks (author, comments) are removed entirely
        if (name.endsWith('.png')) for (const chunk of ['tEXt', 'iTXt', 'zTXt']) expect(text.includes(chunk), `${name} ${chunk}`).toBe(false);
      }
    });
  }

  it('refuses something that is not a Word template', () => {
    expect(() => onLetterhead(new Uint8Array([80, 75, 5, 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]), [])).toThrow(LetterheadError);
  });
});

describe('tables fit the letterhead text area', () => {
  it('reads the text width from the section and scales a wider table down, a narrower one stays', async () => {
    const { fitTables, textWidth } = await import('./letterhead');
    const { table } = await import('./docx');
    expect(textWidth('<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1985" w:right="1440" w:bottom="1134" w:left="1440"/></w:sectPr>')).toBe(9360);
    const wide = fitTables(table([6000, 6000], [['a', 'b']]), 9000);
    expect(wide).toContain('<w:tblW w:w="9000"');
    expect(wide).toContain('<w:gridCol w:w="4500"/>');
    const narrow = table([3000, 3000], [['a', 'b']]);
    expect(fitTables(narrow, 9000)).toBe(narrow);
  });
});

describe('official documents are A4 (Director, 2026-11-22)', () => {
  it('both institution letterheads produce an A4 page, the IMH one although its template is US Letter', async () => {
    const { readFileSync } = await import('node:fs');
    const { strFromU8, unzipSync } = await import('fflate');
    const { A4, onLetterhead, toA4 } = await import('./letterhead');
    const { para } = await import('./docx');
    for (const code of ['imh', 'idss']) {
      const docx = onLetterhead(new Uint8Array(readFileSync(`src/assets/letterheads/${code}.dotx`)), [para('x')]);
      const xml = strFromU8(unzipSync(docx)['word/document.xml'] ?? new Uint8Array());
      expect(xml.match(/<w:pgSz\b[^>]*\/>/g)).toEqual([`<w:pgSz w:w="${A4.width}" w:h="${A4.height}"/>`]);
    }
    expect(toA4('<w:sectPr><w:pgMar w:left="1"/></w:sectPr>')).toContain(`<w:pgSz w:w="${A4.width}" w:h="${A4.height}"/><w:pgMar`);
  });
});
