import type { Result } from '@/lib/tauri/invoke';
import { PRICE_LIST_SEED } from '@/features/price-lists/seed';
import { seedReferenceData } from '@/features/price-lists/repository';
import { INSTITUTIONS_SEED } from './institutions-seed';
import { getDatabaseStatus, type DatabaseStatus } from './repository';

/**
 * Application-layer orchestration for start-up.
 */

/** Open the database status and make sure reference data exists (idempotent). */
export async function initialiseApplication(): Promise<Result<DatabaseStatus>> {
  const status = await getDatabaseStatus();
  if (!status.success) return status;
  const seeded = await seedReferenceData({ institutions: [...INSTITUTIONS_SEED], priceItems: PRICE_LIST_SEED });
  if (!seeded.success) return seeded;
  return status;
}
