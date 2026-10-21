import type { z } from 'zod';
import type { BoardBillingRulesSchema } from '@/lib/validation/schemas';

/**
 * Billing parameters decided by the board (UO IMH / ŠO IDSS) per school year (CONSTITUTION BR-11).
 * The app never assumes them: until entered, nothing is enforced and breakfast is not billed.
 */
export type BoardBillingRules = z.infer<typeof BoardBillingRulesSchema>;

/** School-year order of calendar months, September first. */
export const SCHOOL_YEAR_MONTHS: ReadonlyArray<number> = [9, 10, 11, 12, 1, 2, 3, 4, 5, 6, 7, 8];
