import QRCode from 'qrcode';
import { FENINGS_PER_KM } from '@/constants';
import type { Fenings } from '@/features/billing/money';

/**
 * PROVISIONAL payment QR on the slip (Director, 2026-10-21; DL-P008 addendum).
 * Format ASSUMED until a BiH bank confirms one: EPC "SEPA Credit Transfer" QR (`BCD` / `002`),
 * the most widely read payment QR in the region — with the currency **BAM**, which the EPC
 * specification does not define (it is a EUR standard). Fields respect the EPC length limits.
 */

export interface PaymentQrData {
  readonly bic: string;
  readonly payeeName: string;
  readonly iban: string;
  readonly amount: Fenings;
  readonly remittance: string;
}

const MAX_NAME = 70;
const MAX_REMITTANCE = 140;

function clip(text: string, max: number): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length <= max ? clean : clean.slice(0, max).trimEnd();
}

/** EPC QR payload (lines separated by LF, trailing empty fields omitted). */
export function epcPayload(data: PaymentQrData): string {
  const iban = data.iban.replace(/\s+/g, '').toUpperCase();
  if (!/^BA\d{18}$/.test(iban)) throw new Error(`IBAN ${data.iban} nije ispravan BiH IBAN`);
  if (!/^[A-Z0-9]{8}([A-Z0-9]{3})?$/.test(data.bic)) throw new Error(`SWIFT/BIC ${data.bic} nije ispravan`);
  if (!Number.isInteger(data.amount) || data.amount < 1 || data.amount > 99_999_999_999) throw new Error('iznos za QR mora biti od 0,01 KM');
  const km = Math.floor(data.amount / FENINGS_PER_KM);
  const fenings = String(data.amount % FENINGS_PER_KM).padStart(2, '0');
  return [
    'BCD', // service tag
    '002', // version
    '1', // character set: UTF-8
    'SCT', // credit transfer
    data.bic,
    clip(data.payeeName, MAX_NAME),
    iban,
    `BAM${km}.${fenings}`,
    '', // purpose code
    '', // structured reference (not used together with the free text)
    clip(data.remittance, MAX_REMITTANCE),
  ].join('\n');
}

/** QR module matrix (true = dark), error correction M as the EPC guideline requires. */
export function qrMatrix(payload: string): boolean[][] {
  const qr = QRCode.create(payload, { errorCorrectionLevel: 'M' });
  const size = qr.modules.size;
  return Array.from({ length: size }, (_, row) => Array.from({ length: size }, (_, col) => Boolean(qr.modules.get(row, col))));
}
