import { unzipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { base64, buildEml, chunkBySize, zipFiles } from './bundle';

const bytes = (text: string) => new TextEncoder().encode(text);

describe('zip', () => {
  it('round-trips every file and refuses duplicate names', () => {
    const zip = zipFiles([{ name: 'IMH-001-26.pdf', bytes: bytes('a') }, { name: 'IDSS-001-26.pdf', bytes: bytes('bb') }]);
    const back = unzipSync(zip);
    expect(Object.keys(back).sort()).toEqual(['IDSS-001-26.pdf', 'IMH-001-26.pdf']);
    expect(new TextDecoder().decode(back['IDSS-001-26.pdf'])).toBe('bb');
    expect(() => zipFiles([{ name: 'x.pdf', bytes: bytes('a') }, { name: 'x.pdf', bytes: bytes('b') }])).toThrow();
  });
});

describe('base64', () => {
  it('matches the standard encoding including padding', () => {
    for (const text of ['', 'f', 'fo', 'foo', 'foob', 'Računi čćđšž']) {
      expect(base64(bytes(text))).toBe(Buffer.from(text, 'utf8').toString('base64'));
    }
  });
});

describe('Outlook draft (.eml)', () => {
  const eml = buildEml(
    {
      to: 'info-mejtas@montessorihouse.ba',
      subject: 'Računi IMH i IDSS — novembar 2026',
      body: 'Poštovani,\nu prilogu su računi.',
      attachments: [{ name: 'IMH-001-26.pdf', bytes: bytes('%PDF-1.7') }, { name: 'Racuni.zip', bytes: bytes('PK') }],
    },
    'BOUNDARY',
  );

  it('is an unsent draft addressed to the mailbox, with CRLF lines', () => {
    expect(eml.startsWith('X-Unsent: 1\r\nTo: info-mejtas@montessorihouse.ba\r\n')).toBe(true);
    expect(eml).toContain('Subject: =?UTF-8?B?');
    expect(eml).not.toMatch(/[^\r]\n/);
    expect(eml.endsWith('--BOUNDARY--\r\n')).toBe(true);
  });

  it('attaches each PDF and the zip with the right types', () => {
    expect(eml).toContain('Content-Type: application/pdf; name="IMH-001-26.pdf"');
    expect(eml).toContain('Content-Type: application/zip; name="Racuni.zip"');
    expect(eml).toContain(Buffer.from('%PDF-1.7').toString('base64'));
  });

  it('refuses bad recipients and unsafe attachment names', () => {
    expect(() => buildEml({ to: 'x', subject: '', body: '', attachments: [] }, 'B')).toThrow();
    expect(() => buildEml({ to: 'a@b.ba', subject: '', body: '', attachments: [{ name: '../x.pdf', bytes: bytes('a') }] }, 'B')).toThrow();
  });
});

describe('chunkBySize', () => {
  it('keeps groups under the limit and order intact', () => {
    expect(chunkBySize([4, 4, 4, 9, 1], (n) => n, 8)).toEqual([[4, 4], [4], [9], [1]]);
    expect(chunkBySize([], (n: number) => n, 8)).toEqual([]);
  });
});
