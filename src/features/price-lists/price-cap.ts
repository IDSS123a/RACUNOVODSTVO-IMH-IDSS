import { BASIS_POINTS_FULL, PRICE_CAP_TIERS } from '@/constants';
import { divideRounded, type BasisPoints, type Fenings } from '@/features/billing/money';

/**
 * Price-increase cap check (Program sufinansiranja KS 16/26; CONSTITUTION BR-20).
 * Applies to IMH preschool monthly prices only (the Program covers preschool institutions).
 */

export type PriceCapStatus = 'WITHIN_CAP' | 'EXCEEDED_WITH_APPROVAL' | 'EXCEEDED';

export interface PriceCapResult {
  readonly previous: Fenings;
  readonly next: Fenings;
  /** Increase in basis points, rounded half away from zero (display only). */
  readonly increaseBp: BasisPoints;
  /** Maximum allowed increase for the previous price band. */
  readonly maxIncreaseBp: BasisPoints;
  /** Highest monthly price allowed without ministry approval (exact, may have a fractional fening → floored). */
  readonly maxAllowed: Fenings;
  readonly status: PriceCapStatus;
}

/** The cap band that applies to the previous year's price. */
export function maxIncreaseFor(previous: Fenings): BasisPoints {
  const band = PRICE_CAP_TIERS.find((tier) => tier.upToFenings === null || previous <= tier.upToFenings);
  if (!band) throw new Error('PRICE_CAP_TIERS must end with an open band');
  return band.maxIncreaseBp;
}

/**
 * Compare two monthly prices against the cap.
 * Exactness: the comparison is done in integers (next × 10 000 ≤ previous × (10 000 + cap)).
 * @param previous monthly price in the previous school year
 * @param next monthly price in the new school year
 * @param approvalRecorded true when a written ministry approval is recorded (D16)
 */
export function checkPriceCap(previous: Fenings, next: Fenings, approvalRecorded: boolean): PriceCapResult {
  if (previous <= 0) throw new Error('previous price must be positive');
  const maxIncreaseBp = maxIncreaseFor(previous);
  const limitNumerator = previous * (BASIS_POINTS_FULL + maxIncreaseBp);
  const within = next * BASIS_POINTS_FULL <= limitNumerator;
  const increaseBp = divideRounded((next - previous) * BASIS_POINTS_FULL, previous);
  const maxAllowed = Math.floor(limitNumerator / BASIS_POINTS_FULL);
  const status: PriceCapStatus = within ? 'WITHIN_CAP' : approvalRecorded ? 'EXCEEDED_WITH_APPROVAL' : 'EXCEEDED';
  return { previous, next, increaseBp, maxIncreaseBp, maxAllowed, status };
}
