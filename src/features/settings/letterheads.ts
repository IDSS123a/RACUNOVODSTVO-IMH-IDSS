import idssLetterhead from '@/assets/letterheads/idss.dotx?inline';
import imhLetterhead from '@/assets/letterheads/imh.dotx?inline';
import type { LegalEntityCode } from '@/features/price-lists/types';
import { dataUrlBytes } from '@/lib/export/letterhead';

/**
 * The institutions' official letterheads (Word templates provided by the Director, 2026-11-21:
 * MEMORANDUM_IMH.dotx and MEMORANDUM_IDSS_OD_20042026.dotx; the author's name removed from the metadata, BR-22).
 * Every official Word document — reports and invoices — is produced on them.
 */
const LETTERHEAD: Readonly<Record<LegalEntityCode, string>> = { IMH: imhLetterhead, IDSS: idssLetterhead };

export function letterheadOf(entity: LegalEntityCode): Uint8Array {
  return dataUrlBytes(LETTERHEAD[entity]);
}
