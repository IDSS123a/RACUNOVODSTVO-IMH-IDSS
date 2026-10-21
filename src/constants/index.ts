/**
 * Global named constants (Commander E-11: no magic numbers).
 * Business amounts (prices) are NOT here — they are data (DL-P005).
 */

/** Fenings per convertible mark (1 KM = 100 fenings). */
export const FENINGS_PER_KM = 100;

/** Basis points representing 100 % (12,5 % = 1250 bp). */
export const BASIS_POINTS_FULL = 10_000;

/** Months covered by IDSS annual tuition (01.09.–30.06., IDSS Pravilnik čl. 2). */
export const IDSS_TUITION_MONTHS = 10;

/** Months covered by IMH tuition (September–August, IMH Pravilnik čl. 2). */
export const IMH_TUITION_MONTHS = 12;

/** First month of every school year (September). */
export const SCHOOL_YEAR_START_MONTH = 9;

/** Day of month on which instalments are due (both Pravilnici). */
export const INSTALMENT_DUE_DAY = 5;

/** Maximum IDSS tuition instalments per year (IDSS Pravilnik čl. 2). */
export const IDSS_MAX_TUITION_INSTALMENTS = 12;

/** Locale for all user-facing number and date formatting. */
export const UI_LOCALE = 'bs-BA';

/**
 * Price-increase caps from Program sufinansiranja KS 16/26, by the previous year's
 * monthly price (in fenings) → max increase in basis points.
 */
export const PRICE_CAP_TIERS: ReadonlyArray<{ readonly upToFenings: number | null; readonly maxIncreaseBp: number }> = [
  { upToFenings: 400_00, maxIncreaseBp: 1_000 },
  { upToFenings: 600_00, maxIncreaseBp: 500 },
  { upToFenings: null, maxIncreaseBp: 300 },
];
