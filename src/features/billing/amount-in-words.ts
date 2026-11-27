import { FENINGS_PER_KM } from '@/constants';
import { MoneyError, type Fenings } from './money';

/**
 * Amount in words for invoices ("Slovima"), in the wording of the institutions' own document
 * `IMH-IDSS-Fakturisanje.html` (function `slova`, F1 / SPEC C8), e.g. 68000 → "šest stotina osamdeset i 00/100 KM".
 *
 * Rules taken over exactly from the document:
 * - units and tens: "jedan", "dva", "dvadeset i jedan" (with " i " between tens and units);
 * - hundreds: "sto", "dvije stotine", "tri stotine", "četiri stotine", "pet stotina" … "devet stotina";
 * - thousands: the number ending in 1 / 2 becomes "jedna" / "dvije"; "hiljada" after 1 and 5–20, "hiljade" after 2–4,
 *   11–19 always "hiljada";
 * - format "<words> i <fenings>/100 KM", "nula" for zero.
 * The document stopped below one million; above it the same style continues: "jedan milion", "dva miliona" (11 → "miliona").
 */

const ONES = ['', 'jedan', 'dva', 'tri', 'četiri', 'pet', 'šest', 'sedam', 'osam', 'devet', 'deset', 'jedanaest', 'dvanaest', 'trinaest', 'četrnaest', 'petnaest', 'šesnaest', 'sedamnaest', 'osamnaest', 'devetnaest'];
const TENS = ['', '', 'dvadeset', 'trideset', 'četrdeset', 'pedeset', 'šezdeset', 'sedamdeset', 'osamdeset', 'devedeset'];
const HUNDREDS = ['', 'sto', 'dvije stotine', 'tri stotine', 'četiri stotine', 'pet stotina', 'šest stotina', 'sedam stotina', 'osam stotina', 'devet stotina'];

/** 1–999 in words, as the document's `h` helper. */
function belowThousand(n: number): string {
  const words: string[] = [];
  if (n >= 100) words.push(HUNDREDS[Math.floor(n / 100)] ?? '');
  const rest = n % 100;
  if (rest >= 20) words.push((TENS[Math.floor(rest / 10)] ?? '') + (rest % 10 ? ` i ${ONES[rest % 10] ?? ''}` : ''));
  else if (rest > 0) words.push(ONES[rest] ?? '');
  return words.join(' ');
}

/** Whole number 0–999.999.999.999.999 in words (milijarda, bilion above a million, in the same style). */
export function integerInWords(n: number): string {
  if (!Number.isSafeInteger(n) || n < 0 || n > 999_999_999_999_999) throw new MoneyError(`cannot spell ${n}`);
  if (n === 0) return 'nula';
  if (n > 999_999_999) {
    // above the highest amount an invoice can have since 2026-11-27 (MAX_AMOUNT); kept so that an invoice issued
    // before the limit, and its credit note, can still be printed
    const trillions = Math.floor(n / 1_000_000_000_000);
    const billions = Math.floor(n / 1_000_000_000) % 1000;
    const below = n % 1_000_000_000;
    const parts: string[] = [];
    if (trillions > 0) parts.push(`${belowThousand(trillions)} ${trillions % 10 === 1 && trillions % 100 !== 11 ? 'bilion' : 'biliona'}`);
    if (billions > 0) {
      const last = billions % 10;
      const lastTwo = billions % 100;
      let text = belowThousand(billions);
      if (last === 1 || last === 2) text = text.replace(/jedan$/, 'jedna').replace(/dva$/, 'dvije');
      parts.push(`${text} ${lastTwo > 10 && lastTwo < 20 ? 'milijardi' : last === 1 ? 'milijarda' : last >= 2 && last <= 4 ? 'milijarde' : 'milijardi'}`);
    }
    if (below > 0) parts.push(integerInWords(below));
    return parts.join(' ');
  }
  const millions = Math.floor(n / 1_000_000);
  const thousands = Math.floor(n / 1000) % 1000;
  const rest = n % 1000;
  const words: string[] = [];
  if (millions > 0) {
    words.push(`${belowThousand(millions)} ${millions % 10 === 1 && millions % 100 !== 11 ? 'milion' : 'miliona'}`);
  }
  if (thousands > 0) {
    const lastTwo = thousands % 100;
    const last = thousands % 10;
    let text = belowThousand(thousands);
    if (last === 1 || last === 2) text = text.replace(/jedan$/, 'jedna').replace(/dva$/, 'dvije');
    const noun = lastTwo > 10 && lastTwo < 20 ? 'hiljada' : last === 1 ? 'hiljada' : last >= 2 && last <= 4 ? 'hiljade' : 'hiljada';
    words.push(`${text} ${noun}`);
  }
  if (rest > 0) words.push(belowThousand(rest));
  return words.join(' ');
}

/** Invoice amount in words: "<words> i <fenings>/100 KM" (the document's format). */
export function amountInWords(amount: Fenings): string {
  if (!Number.isInteger(amount) || amount < 0) throw new MoneyError(`invalid amount ${amount}`);
  const km = Math.floor(amount / FENINGS_PER_KM);
  const fenings = amount % FENINGS_PER_KM;
  return `${integerInWords(km)} i ${String(fenings).padStart(2, '0')}/100 KM`;
}
