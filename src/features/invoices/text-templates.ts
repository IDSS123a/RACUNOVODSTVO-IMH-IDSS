import { formatDate } from '@/lib/format';
import { MONTH_NAME } from './types';

/**
 * Text templates for every free-text entry on invoices and payments (Director, 2026-11-21: „ponudi operateru gotove
 * šablone … presretanje greške, svi unosi moraju biti identične sintakse“). The operator picks a template and fills
 * typed fields (month, year, date, number, name); the text is always assembled here, so the same fact is always
 * written the same way — in the register, on the PDF, in exports and in the audit trail.
 *
 * Every template field also lets the operator write it differently (Director, 2026-11-22: „za svako polje mora
 * postojati šablon ali i mogućnost da se drugačije unese — to vrijedi za cijelu aplikaciju“):
 * - a field with proposed values (`options`) offers them, but any other value can be typed;
 * - every template list ends with „Drugačije — upišite sami“, a free text that is only tidied (spaces, capital
 *   initial) and checked (length, no control characters).
 */

export type ParamKind = 'month' | 'year' | 'schoolYear' | 'date' | 'number' | 'count' | 'text' | 'choice';

export interface TemplateParam {
  readonly key: string;
  readonly label: string;
  readonly kind: ParamKind;
  /** Proposed values (the first is the default); any other value may still be typed. */
  readonly options?: ReadonlyArray<string>;
}

export interface TextTemplate {
  readonly id: string;
  readonly label: string;
  readonly params: ReadonlyArray<TemplateParam>;
  /** Pattern with `{key}` placeholders. */
  readonly pattern: string;
}

export type TemplateValues = Readonly<Record<string, string>>;

const p = (key: string, label: string, kind: ParamKind, options?: ReadonlyArray<string>): TemplateParam => (options ? { key, label, kind, options } : { key, label, kind });
const MONTH = p('mjesec', 'Mjesec', 'month');
const YEAR = p('godina', 'Godina', 'year');
const SCHOOL_YEAR = p('skolska', 'Školska godina', 'schoolYear');
const DATE = p('datum', 'Datum', 'date');
const NUMBER = p('broj', 'Broj', 'number');
const NAME = p('naziv', 'Naziv', 'text');

/** Line description of a service outside the price list (manual invoice, extra service on a monthly invoice). */
export const SERVICE_TEMPLATES: ReadonlyArray<TextTemplate> = [
  // the summer school lasts two weeks; a child may attend one of them or both (Director, 2026-11-22)
  {
    id: 'summer',
    label: 'Ljetna škola',
    params: [YEAR, p('sedmice', 'Sedmice', 'choice', ['1. i 2. sedmica', '1. sedmica', '2. sedmica'])],
    pattern: 'Ljetna škola {godina} — {sedmice}',
  },
  { id: 'trip', label: 'Izlet', params: [NAME, DATE], pattern: 'Izlet — {naziv} ({datum})' },
  { id: 'program', label: 'Dodatni program', params: [NAME, MONTH, YEAR], pattern: 'Dodatni program — {naziv} ({mjesec} {godina})' },
  { id: 'workshop', label: 'Radionica', params: [NAME, DATE], pattern: 'Radionica — {naziv} ({datum})' },
  { id: 'other', label: 'Ostala usluga', params: [NAME], pattern: 'Ostala usluga — {naziv}' },
];

/** Basis of a service outside the price list. */
export const BASIS_TEMPLATES: ReadonlyArray<TextTemplate> = [
  { id: 'notice', label: 'Obavijest roditeljima', params: [DATE], pattern: 'Obavijest roditeljima od {datum}' },
  { id: 'uo', label: 'Odluka UO IMH', params: [NUMBER, DATE], pattern: 'Odluka UO IMH br. {broj} od {datum}' },
  { id: 'so', label: 'Odluka ŠO IDSS', params: [NUMBER, DATE], pattern: 'Odluka ŠO IDSS br. {broj} od {datum}' },
  { id: 'contract', label: 'Ugovor', params: [NUMBER, DATE], pattern: 'Ugovor br. {broj} od {datum}' },
];

/** Purpose of a payment. */
export const PAYMENT_PURPOSE_TEMPLATES: ReadonlyArray<TextTemplate> = [
  { id: 'tuition', label: 'Uplata školarine za mjesec', params: [MONTH, YEAR], pattern: 'Uplata školarine za {mjesec} {godina}' },
  { id: 'enrolment', label: 'Uplata upisnih troškova', params: [SCHOOL_YEAR], pattern: 'Uplata upisnih troškova za školsku {skolska}' },
  { id: 'invoice', label: 'Uplata po računu', params: [p('racun', 'Broj računa', 'number')], pattern: 'Uplata po računu {racun}' },
  { id: 'partial', label: 'Djelimična uplata po računu', params: [p('racun', 'Broj računa', 'number')], pattern: 'Djelimična uplata po računu {racun}' },
];

/** Purpose of a payment without an invoice (prepayment, specs/family-advance). */
export const PREPAYMENT_PURPOSE_TEMPLATES: ReadonlyArray<TextTemplate> = [
  { id: 'month', label: 'Uplata unaprijed za mjesec', params: [MONTH, YEAR], pattern: 'Uplata unaprijed za {mjesec} {godina}' },
  { id: 'year', label: 'Uplata unaprijed za školsku godinu', params: [SCHOOL_YEAR], pattern: 'Uplata unaprijed za školsku {skolska}' },
  { id: 'summer', label: 'Uplata unaprijed za ljetnu školu', params: [YEAR], pattern: 'Uplata unaprijed za ljetnu školu {godina}' },
  { id: 'unknown', label: 'Uplata bez navedene svrhe', params: [], pattern: 'Uplata bez navedene svrhe — pretplata' },
];

/** Reference of a payment (where it was booked from). */
export const PAYMENT_REFERENCE_TEMPLATES: ReadonlyArray<TextTemplate> = [
  { id: 'statement', label: 'Bankovni izvod', params: [NUMBER, DATE], pattern: 'Izvod br. {broj} od {datum}' },
  { id: 'receipt', label: 'Priznanica (gotovina)', params: [NUMBER, DATE], pattern: 'Priznanica br. {broj} od {datum}' },
];

/** Reason of a credit note (storno). */
export const CREDIT_NOTE_REASON_TEMPLATES: ReadonlyArray<TextTemplate> = [
  { id: 'withdrawal', label: 'Ispis djeteta', params: [DATE], pattern: 'Ispis djeteta od {datum}' },
  { id: 'wrongAmount', label: 'Pogrešan iznos na računu', params: [], pattern: 'Pogrešan iznos na računu' },
  { id: 'duplicate', label: 'Dupli račun za isti period', params: [], pattern: 'Dupli račun za isti period' },
  { id: 'wrongChild', label: 'Račun izdat za pogrešno dijete', params: [], pattern: 'Račun izdat za pogrešno dijete' },
  { id: 'decision', label: 'Umanjenje po odluci odbora', params: [NUMBER, DATE], pattern: 'Umanjenje po odluci br. {broj} od {datum}' },
  { id: 'other', label: 'Ostalo (kratak opis)', params: [p('opis', 'Opis', 'text')], pattern: 'Ostalo — {opis}' },
];

/** Reason of a payment reversal (counter-entry, S4). */
export const REVERSAL_REASON_TEMPLATES: ReadonlyArray<TextTemplate> = [
  { id: 'otherChild', label: 'Uplata pripada drugom djetetu', params: [p('ime', 'Ime djeteta', 'text')], pattern: 'Uplata pripada drugom djetetu: {ime}' },
  { id: 'wrongAmount', label: 'Pogrešno knjižen iznos', params: [NUMBER], pattern: 'Pogrešno knjižen iznos (izvod br. {broj})' },
  { id: 'duplicate', label: 'Dvaput knjižena ista uplata', params: [], pattern: 'Dvaput knjižena ista uplata' },
  { id: 'returned', label: 'Uplata vraćena uplatiocu', params: [DATE], pattern: 'Uplata vraćena uplatiocu {datum}' },
];

/** Note of a refund of prepaid money. */
export const CREDIT_REFUND_TEMPLATES: ReadonlyArray<TextTemplate> = [
  { id: 'refund', label: 'Povrat preplate uplatiocu', params: [NUMBER, DATE], pattern: 'Povrat preplate uplatiocu, izvod br. {broj} od {datum}' },
];

/** The value of one field as printed, or null when it is missing or malformed. */
export function formatParam(kind: ParamKind, raw: string): string | null {
  const value = raw.trim().replace(/\s+/g, ' ');
  if (value === '') return null;
  switch (kind) {
    case 'month':
      return MONTH_NAME.includes(value) ? value : null;
    case 'year':
      return /^20\d{2}$/.test(value) ? value : null;
    case 'schoolYear': {
      const m = /^(20\d{2})\/(20\d{2})$/.exec(value);
      return m && Number(m[2]) === Number(m[1]) + 1 ? value : null;
    }
    case 'date':
      return /^\d{4}-\d{2}-\d{2}$/.test(value) ? formatDate(value) : null;
    case 'count':
      return /^[1-9]\d?$/.test(value) ? value : null;
    case 'number':
      // invoice, decision and statement numbers: digits, letters, „-“ and „/“ (e.g. 12/26, IMH-004/26)
      return /^[0-9A-Za-zČĆŠŽĐčćšžđ][0-9A-Za-zČĆŠŽĐčćšžđ\-/.]{0,29}$/.test(value) ? value : null;
    case 'text':
    case 'choice':
      // a name, never a sentence: the template carries the syntax
      return value.length <= 60 && !/[{}\p{Cc}]/u.test(value) ? value : null;
  }
}

/** The template id of „Drugačije — upišite sami“, added to every template list by the template field. */
export const FREE_TEXT_ID = 'free';
export const FREE_TEXT_LABEL = 'Drugačije — upišite sami';
export const FREE_TEXT_MAX = 120;

/** A text written differently from the templates: single spaces, capital initial; null when empty, too long or with control characters. */
export function formatFreeText(raw: string): string | null {
  if (/[{}\p{Cc}]/u.test(raw.replace(/[\t\n\r]/g, ' '))) return null;
  const value = raw.replace(/\s+/g, ' ').trim();
  if (value.length < 2 || value.length > FREE_TEXT_MAX) return null;
  return value.charAt(0).toLocaleUpperCase('bs') + value.slice(1);
}

/** The assembled text, or null while a field is missing or malformed. */
export function renderTemplate(template: TextTemplate, values: TemplateValues): string | null {
  let text = template.pattern;
  for (const param of template.params) {
    const formatted = formatParam(param.kind, values[param.key] ?? '');
    if (formatted === null) return null;
    text = text.split(`{${param.key}}`).join(formatted);
  }
  return text;
}

/** Defaults for the fields of a template: the current month and year, today, and anything the caller knows. */
export function defaultValues(template: TextTemplate, today: string, known: TemplateValues = {}): Record<string, string> {
  const month = MONTH_NAME[Number(today.slice(5, 7)) - 1] ?? '';
  const year = today.slice(0, 4);
  const start = Number(today.slice(5, 7)) >= 9 ? Number(year) : Number(year) - 1;
  const values: Record<string, string> = {};
  for (const param of template.params) {
    values[param.key] =
      known[param.key] ??
      (param.kind === 'month'
        ? month
        : param.kind === 'year'
          ? year
          : param.kind === 'schoolYear'
            ? `${start}/${start + 1}`
            : param.kind === 'date'
              ? today
              : (param.options?.[0] ?? ''));
  }
  return values;
}

/** Relation of the payer to the child (specs/family-advance §1, Q6): a proposal, or typed freely. */
export const PAYER_RELATIONS: ReadonlyArray<string> = [
  'roditelj / staratelj',
  'djed',
  'baka',
  'tetka',
  'ujak',
  'stric',
  'brat / sestra',
];

/** The relation proposed for a parent from the record (Q6). */
export const PARENT_RELATION = 'roditelj / staratelj';

const sameName = (a: string, b: string): boolean => a.replace(/\s+/g, ' ').trim().toLowerCase() === b.replace(/\s+/g, ' ').trim().toLowerCase();

/**
 * The relation after the payer's name changed (C-13, 2026-11-28): a parent from the record gets „roditelj / staratelj“;
 * anyone else must have the relation typed, so the proposed parent relation is cleared and never stays by mistake.
 * A relation the operator typed is kept.
 */
export function relationForPayer(payerName: string, parentNames: ReadonlyArray<string>, current: string): string {
  const isParent = parentNames.some((p) => p.trim() !== '' && sameName(p, payerName));
  if (isParent) return current.trim() === '' ? PARENT_RELATION : current;
  return current.trim() === PARENT_RELATION ? '' : current;
}
