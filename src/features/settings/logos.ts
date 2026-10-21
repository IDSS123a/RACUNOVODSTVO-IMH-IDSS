import idssLogo from '@/assets/logos/idss.png';
import imhLogo from '@/assets/logos/imh.png';
import type { LegalEntityCode } from '@/features/price-lists/types';

/**
 * Official logos (provided by the Director, 2026-10-21) — bundled with the app,
 * used on screen, on invoices and in printed reports (BR-2).
 */
export const ENTITY_LOGO: Readonly<Record<LegalEntityCode, string>> = {
  IMH: imhLogo,
  IDSS: idssLogo,
};
