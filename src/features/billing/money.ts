import { BASIS_POINTS_FULL, FENINGS_PER_KM, UI_LOCALE } from '@/constants';

/**
 * Money domain — the ONLY place where amounts are rounded (DL-P003, M-7).
 *
 * All amounts are integer fenings (1 KM = 100). Percentages are integer
 * basis points (12,5 % = 1250). Floating-point money anywhere else is a bug.
 */

/** An integer amount of fenings. */
export type Fenings = number;

/** An integer percentage in basis points (100 % = 10 000). */
export type BasisPoints = number;

/** Thrown when a value is not a valid integer amount. */
export class MoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MoneyError';
  }
}

function assertInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError(`${label} must be a safe integer, got ${String(value)}`);
  }
}

/**
 * Divide two integers and round half away from zero.
 * WHY: avoids binary floating point entirely (e.g. 1103 × 0,85 ≠ 937,55 in IEEE 754).
 * @param numerator integer numerator
 * @param denominator positive integer denominator
 * @returns the rounded integer quotient
 */
export function divideRounded(numerator: number, denominator: number): number {
  assertInteger(numerator, 'numerator');
  assertInteger(denominator, 'denominator');
  if (denominator <= 0) throw new MoneyError('denominator must be positive');
  const sign = numerator < 0 ? -1 : 1;
  const absolute = Math.abs(numerator);
  const quotient = Math.floor((absolute * 2 + denominator) / (denominator * 2));
  return sign * quotient;
}

/**
 * Convert a KM amount given as a decimal string or number with at most 2 decimals to fenings.
 * @param km e.g. "1.234,56", "1234.56" or 1234.56
 * @returns integer fenings
 */
export function kmToFenings(km: string | number): Fenings {
  const text = typeof km === 'number' ? km.toFixed(2) : normalizeDecimal(km);
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(text);
  if (!match) throw new MoneyError(`invalid KM amount: "${String(km)}"`);
  const [, minus, whole, fraction = ''] = match;
  const fenings = Number(whole) * FENINGS_PER_KM + Number(fraction.padEnd(2, '0'));
  return minus === '-' ? -fenings : fenings;
}

/** Accepts bs-BA ("1.234,56") and plain ("1234.56") notations. */
function normalizeDecimal(raw: string): string {
  const trimmed = raw.trim().replace(/\s|KM/gi, '');
  if (trimmed.includes(',')) return trimmed.replace(/\./g, '').replace(',', '.');
  return trimmed;
}

/**
 * Apply a percentage to an amount, rounding exactly once.
 * @param amount base amount in fenings
 * @param basisPoints percentage in basis points
 * @returns amount × bp / 10 000, rounded half away from zero
 */
export function percentOf(amount: Fenings, basisPoints: BasisPoints): Fenings {
  assertInteger(amount, 'amount');
  assertInteger(basisPoints, 'basisPoints');
  return divideRounded(amount * basisPoints, BASIS_POINTS_FULL);
}

/**
 * Reduce an amount by a discount, rounding exactly once.
 * @param amount base amount in fenings
 * @param discountBp discount in basis points (0–10 000)
 * @returns the discounted amount
 */
export function applyDiscount(amount: Fenings, discountBp: BasisPoints): Fenings {
  if (discountBp < 0 || discountBp > BASIS_POINTS_FULL) {
    throw new MoneyError(`discount must be between 0 and ${BASIS_POINTS_FULL} bp, got ${discountBp}`);
  }
  return percentOf(amount, BASIS_POINTS_FULL - discountBp);
}

/**
 * Scale an amount by a ratio of whole numbers (e.g. 6 of 10 months), rounding exactly once.
 * @param amount base amount in fenings
 * @param part numerator (e.g. months charged)
 * @param whole denominator (e.g. months in the tuition year)
 */
export function prorate(amount: Fenings, part: number, whole: number): Fenings {
  assertInteger(amount, 'amount');
  assertInteger(part, 'part');
  if (part < 0 || part > whole) throw new MoneyError(`part ${part} outside 0..${whole}`);
  return divideRounded(amount * part, whole);
}

/** Sum integer amounts (no rounding needed — every addend is already rounded). */
export function sum(amounts: ReadonlyArray<Fenings>): Fenings {
  return amounts.reduce((total, amount) => {
    assertInteger(amount, 'amount');
    return total + amount;
  }, 0);
}

const kmFormatter = new Intl.NumberFormat(UI_LOCALE, {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
  useGrouping: true,
});

/**
 * Format fenings for display, e.g. 123456 → "1.234,56 KM".
 * WHY explicit grouping: some runtimes ship bs-BA without the 4-digit grouping rule.
 */
export function formatKM(amount: Fenings): string {
  assertInteger(amount, 'amount');
  const parts = kmFormatter.formatToParts(amount / FENINGS_PER_KM);
  const text = parts
    .map((part) => (part.type === 'group' ? '.' : part.type === 'decimal' ? ',' : part.value))
    .join('');
  return `${text} KM`;
}

/** Format basis points for display, e.g. 1250 → "12,5 %". */
export function formatPercent(basisPoints: BasisPoints): string {
  assertInteger(basisPoints, 'basisPoints');
  const value = basisPoints / 100;
  const text = Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/0$/, '');
  return `${text.replace('.', ',')} %`;
}
