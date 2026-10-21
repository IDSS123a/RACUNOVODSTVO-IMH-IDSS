import { FENINGS_PER_KM } from '@/constants';
import { MoneyError, type Fenings } from './money';

/**
 * Amount in words for invoices ("slovima"), Bosnian, e.g. 132000 → "hiljadu trista dvadeset KM i 00/100".
 * The marka is feminine (jedna, dvije); hiljada is feminine; milion is masculine.
 */

const UNITS_M = ['nula', 'jedan', 'dva', 'tri', 'četiri', 'pet', 'šest', 'sedam', 'osam', 'devet'];
const TEENS = ['deset', 'jedanaest', 'dvanaest', 'trinaest', 'četrnaest', 'petnaest', 'šesnaest', 'sedamnaest', 'osamnaest', 'devetnaest'];
const TENS = ['', '', 'dvadeset', 'trideset', 'četrdeset', 'pedeset', 'šezdeset', 'sedamdeset', 'osamdeset', 'devedeset'];
const HUNDREDS = ['', 'sto', 'dvjesta', 'trista', 'četiristo', 'petsto', 'šesto', 'sedamsto', 'osamsto', 'devetsto'];

type Gender = 'M' | 'F';

function unit(n: number, gender: Gender): string {
  if (gender === 'F' && n === 1) return 'jedna';
  if (gender === 'F' && n === 2) return 'dvije';
  return UNITS_M[n] ?? '';
}

/** 1–999 in words. */
function belowThousand(n: number, gender: Gender): string[] {
  const words: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds > 0) words.push(HUNDREDS[hundreds] ?? '');
  if (rest >= 10 && rest < 20) words.push(TEENS[rest - 10] ?? '');
  else {
    const tens = Math.floor(rest / 10);
    const units = rest % 10;
    if (tens >= 2) words.push(TENS[tens] ?? '');
    if (units > 0) words.push(unit(units, gender));
  }
  return words;
}

/** Grammatical form after a number: 1 → one, 2–4 → few, otherwise many (11–14 → many). */
function form(n: number, one: string, few: string, many: string): string {
  const lastTwo = n % 100;
  const last = n % 10;
  if (lastTwo >= 11 && lastTwo <= 14) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}

/** Whole number 0–999.999.999 in words, feminine (for KM). */
export function integerInWords(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n > 999_999_999) throw new MoneyError(`cannot spell ${n}`);
  if (n === 0) return 'nula';
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor((n % 1_000_000) / 1000);
  const rest = n % 1000;
  const words: string[] = [];
  if (millions > 0) {
    words.push(...(millions === 1 ? [] : belowThousand(millions, 'M')), form(millions, 'milion', 'miliona', 'miliona'));
  }
  if (thousands > 0) {
    if (thousands === 1) words.push('hiljadu');
    else words.push(...belowThousand(thousands, 'F'), form(thousands, 'hiljada', 'hiljade', 'hiljada'));
  }
  if (rest > 0) words.push(...belowThousand(rest, 'F'));
  return words.join(' ');
}

/** Invoice amount in words: "<KM in words> KM i <fenings>/100". */
export function amountInWords(amount: Fenings): string {
  if (!Number.isInteger(amount) || amount < 0) throw new MoneyError(`invalid amount ${amount}`);
  const km = Math.floor(amount / FENINGS_PER_KM);
  const fenings = amount % FENINGS_PER_KM;
  return `${integerInWords(km)} KM i ${String(fenings).padStart(2, '0')}/100`;
}
