import { z } from 'zod';

/**
 * Canonical formats of every entered value (Director, 2026-11-21: „svako polje mora imati presretanje greške i
 * dozvoljene formate … ne može broj telefona jednom biti 033562114 a drugi put +387/33 561-226“).
 * Each normalizer accepts the usual ways of typing a value and returns its ONE canonical form, or null when the value
 * is not valid. Forms validate with the `*Field` schemas below, so only canonical values are ever saved.
 * Stored data is still READ with the lenient schemas (imported records keep their original form until edited).
 */

const LETTERS = 'A-Za-zČĆŠŽĐčćšžđÄÖÜäöüßÉéÈèÀàÇçÑñ';

/** Collapse every run of whitespace to one space and trim. */
export function squashSpaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function capitalizeWord(word: string): string {
  // a word typed all in lower or all in upper case is written as a name; mixed case is kept (e.g. „McKenzie“)
  if (word !== word.toLocaleLowerCase('bs') && word !== word.toLocaleUpperCase('bs')) return word;
  const lower = word.toLocaleLowerCase('bs');
  return lower.charAt(0).toLocaleUpperCase('bs') + lower.slice(1);
}

/** A name part or full name: letters, space, hyphen, apostrophe; each word with a capital initial. */
export function normalizeName(value: string): string | null {
  const text = squashSpaces(value).replace(/\s*-\s*/g, '-').replace(/[’`]/g, "'");
  if (!new RegExp(`^[${LETTERS}]+(?:[ '\\-][${LETTERS}]+)*$`).test(text) || text.length > 80) return null;
  // every word between a space, hyphen or apostrophe gets the capital initial („o'neil“ → „O'Neil“)
  return text.split(/([ '-])/).map((piece) => (/^[ '-]$/.test(piece) ? piece : capitalizeWord(piece))).join('');
}

/** Ime i prezime: at least two words. */
export function normalizeFullName(value: string): string | null {
  const name = normalizeName(value);
  return name && name.includes(' ') ? name : null;
}

/**
 * Telephone. Bosnia and Herzegovina: „+387 33 562 114“ (8 digits) or „+387 60 345 1275“ (9 digits); typed with or
 * without +387 / 00387 / the leading 0, with spaces, „/“, „-“, „.“ or brackets. Other countries: E.164 „+4917612345678“.
 */
export function normalizePhone(value: string): string | null {
  let digits = value.trim().replace(/[\s/\-().]/g, '');
  if (digits === '') return null;
  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`;
  else if (digits.startsWith('0')) digits = `+387${digits.slice(1)}`;
  else if (!digits.startsWith('+')) return null;
  if (!/^\+\d{8,15}$/.test(digits)) return null;
  if (!digits.startsWith('+387')) return digits;
  const national = digits.slice(4);
  if (!/^[3-6]\d{7,8}$/.test(national)) return null;
  return `+387 ${national.slice(0, 2)} ${national.slice(2, 5)} ${national.slice(5)}`;
}

/** E-mail: trimmed, lower case. */
export function normalizeEmail(value: string): string | null {
  const text = value.trim().toLowerCase();
  return /^[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}$/.test(text) ? text : null;
}

function mod97(digits: string): number {
  let remainder = 0;
  for (const digit of digits) remainder = (remainder * 10 + Number(digit)) % 97;
  return remainder;
}

/** IBAN of Bosnia and Herzegovina with its check digits (ISO 13616): „BA39 1990 4900 5848 7943“. */
export function normalizeIban(value: string): string | null {
  const compact = value.toUpperCase().replace(/[\s\-_.]/g, '');
  if (!/^BA\d{18}$/.test(compact)) return null;
  const numeric = (compact.slice(4) + compact.slice(0, 4)).replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - 55));
  if (mod97(numeric) !== 1) return null;
  return compact.replace(/(.{4})(?=.)/g, '$1 ');
}

/** BiH transaction account, 16 digits with its two control digits (ISO 7064 MOD 97-10): „1990 4900 5848 7943“. */
export function normalizeBankAccount(value: string): string | null {
  const digits = value.replace(/[\s\-.]/g, '');
  if (!/^\d{16}$/.test(digits)) return null;
  if (98 - mod97(`${digits.slice(0, 14)}00`) !== Number(digits.slice(14))) return null;
  return digits.replace(/(.{4})(?=.)/g, '$1 ');
}

/** SWIFT / BIC: 8 or 11 characters, upper case. */
export function normalizeSwift(value: string): string | null {
  const text = value.replace(/\s/g, '').toUpperCase();
  return /^[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/.test(text) ? text : null;
}

/** ID (JIB) of a legal entity: 13 digits. */
export function normalizeJib(value: string): string | null {
  const digits = value.replace(/[\s\-.]/g, '');
  return /^\d{13}$/.test(digits) ? digits : null;
}

/** Web address: lower case, without protocol and trailing slash: „www.montessorihouse.ba“. */
export function normalizeWebsite(value: string): string | null {
  const text = value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  return /^[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(text) ? text : null;
}

/**
 * Postal address „Ulica i broj, 71000 Sarajevo“ (more parts allowed, e.g. „…, Bosna i Hercegovina“): one space after
 * every comma, the postal code as 5 digits, a capital initial. It must contain a house number or „bb“.
 */
export function normalizeAddress(value: string): string | null {
  const parts = squashSpaces(value)
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/\b(\d{2}) (\d{3})\b/, '$1$2'))
    .map((part) => part.charAt(0).toLocaleUpperCase('bs') + part.slice(1))
    // the place after the postal code also starts with a capital letter („71000 sarajevo“ → „71000 Sarajevo“)
    .map((part) => part.replace(/^(\d{5}) (\S)/, (_, code: string, first: string) => `${code} ${first.toLocaleUpperCase('bs')}`));
  const text = parts.join(', ');
  if (text.length < 5 || text.length > 150) return null;
  if (!/(\d|\bbb\b)/i.test(parts[0] ?? '')) return null;
  return text.replace(/\bBB\b/, 'bb');
}

/**
 * Unit of measure (JM) of an invoice line: proposed units (srv, kom, sedm. …) or any other short unit — letters and
 * dots, up to 10 characters, lower case (Director, 2026-11-22). Null when empty or not a unit.
 */
export function normalizeUnit(value: string): string | null {
  const text = squashSpaces(value).toLocaleLowerCase('bs');
  return new RegExp(`^[${LETTERS}][${LETTERS}. ]{0,9}$`).test(text) ? text : null;
}

/** Number of a document, decision or bank statement: „12/26“, „02-1-123/26“, „ŠO-7/2026“. */
export function normalizeDocumentNumber(value: string): string | null {
  // spaces are allowed only around „/“ and „-“ (they are removed); a word with a space („br. 12“) is not a number
  const text = squashSpaces(value).replace(/\s*([/-])\s*/g, '$1');
  return new RegExp(`^[0-9${LETTERS}][0-9${LETTERS}\\-/.]{0,29}$`).test(text) && /\d/.test(text) ? text : null;
}

/** Court registration of an institution: optional label, then „65-01-0165-12“. */
export function normalizeRegistration(value: string): string | null {
  const text = squashSpaces(value);
  return /^(?:[A-Za-zČĆŠŽĐčćšžđ. ]+ )?\d{2}-\d{2}-\d{4}-\d{2}$/.test(text) ? text : null;
}

/** Short free text (job title, note, bank name): squashed, letters required, no braces. */
export function normalizeText(value: string, max: number): string | null {
  const text = squashSpaces(value);
  return text.length > 0 && text.length <= max && new RegExp(`[${LETTERS}]`).test(text) && !/[{}<>]/.test(text) ? text : null;
}

/** An ISO date `YYYY-MM-DD` that exists in the calendar. */
export function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

// ---------- Zod field builders for forms ----------

type Normalizer = (value: string) => string | null;

/** A required field: the canonical value, or the message (with the allowed format). */
export function requiredField(normalize: Normalizer, message: string) {
  return z.string().transform((value, ctx) => {
    const normalized = normalize(value);
    if (normalized === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      return z.NEVER;
    }
    return normalized;
  });
}

/** An optional field: empty stays empty; anything typed must be valid. */
export function optionalField(normalize: Normalizer, message: string) {
  return z.string().transform((value, ctx) => {
    if (value.trim() === '') return '';
    const normalized = normalize(value);
    if (normalized === null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message });
      return z.NEVER;
    }
    return normalized;
  });
}

/** Allowed format of each kind, shown under the field and in the error message. */
export const FORMAT = {
  name: 'slova, razmak i crtica (npr. Ana-Marija)',
  fullName: 'ime i prezime (npr. Amra Begić)',
  phone: '+387 33 562 114 · +387 61 234 567 · strani: +4917612345678',
  email: 'ime@domena.ba',
  iban: 'BA39 1990 4900 5848 7943 (s kontrolnim brojem)',
  bankAccount: '16 cifara, npr. 1990 4900 5848 7943',
  swift: '8 ili 11 znakova, npr. ABSBBA22',
  jib: '13 cifara',
  website: 'www.domena.ba',
  address: 'Ulica i broj, 71000 Sarajevo',
  documentNumber: 'npr. 12/26 ili 02-1-123/26',
  registration: 'npr. Reg. broj 65-01-0165-12',
} as const;

export const nameField = () => requiredField(normalizeName, `Neispravno ime. Dozvoljeno: ${FORMAT.name}.`);
export const fullNameField = () => requiredField(normalizeFullName, `Unesite ${FORMAT.fullName}.`);
export const phoneField = () => optionalField(normalizePhone, `Neispravan telefon. Format: ${FORMAT.phone}.`);
export const emailField = () => optionalField(normalizeEmail, `Neispravan e-mail. Format: ${FORMAT.email}.`);
export const ibanField = () => optionalField(normalizeIban, `Neispravan IBAN. Format: ${FORMAT.iban}.`);
export const addressField = () => requiredField(normalizeAddress, `Neispravna adresa. Format: ${FORMAT.address}.`);
export const optionalAddressField = () => optionalField(normalizeAddress, `Neispravna adresa. Format: ${FORMAT.address}.`);
export const textField = (max: number, label: string) => requiredField((v) => normalizeText(v, max), `Unesite ${label} (do ${max} znakova).`);
export const optionalTextField = (max: number) => optionalField((v) => normalizeText(v, max), `Najviše ${max} znakova, bez znakova { } < >.`);
