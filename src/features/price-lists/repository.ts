import { z } from 'zod';
import { call, type Result } from '@/lib/tauri/invoke';
import { InstitutionsSchema, PriceListItemsSchema } from '@/lib/validation/schemas';
import type { PriceListItem, SchoolYear } from './types';

/** Price-list repository — Infrastructure layer (A-3). */

/** Price-list rows, optionally for one school year. */
export async function listPriceItems(schoolYear?: SchoolYear): Promise<Result<PriceListItem[]>> {
  const result = await call('list_price_items', PriceListItemsSchema, { schoolYear: schoolYear ?? null });
  // WHY the cast: Zod validates schoolYear with a regex; the template-literal type is narrower.
  return result.success ? { success: true, data: result.data as PriceListItem[] } : result;
}

export async function listSchoolYears(): Promise<Result<SchoolYear[]>> {
  const result = await call('list_school_years', z.array(z.string().regex(/^\d{4}\/\d{4}$/)));
  return result.success ? { success: true, data: result.data as SchoolYear[] } : result;
}

/** Seed institutions and price lists on first run; returns true when seeding happened. */
export function seedReferenceData(data: {
  institutions: z.infer<typeof InstitutionsSchema>;
  priceItems: ReadonlyArray<PriceListItem>;
}): Promise<Result<boolean>> {
  const payload = {
    institutions: InstitutionsSchema.parse(data.institutions),
    priceItems: PriceListItemsSchema.parse(data.priceItems),
  };
  return call('seed_reference_data', z.boolean(), { data: payload });
}
