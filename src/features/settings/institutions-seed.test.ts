import { describe, expect, it } from 'vitest';
import { InstitutionSchema } from '@/lib/validation/schemas';
import { INSTITUTIONS_SEED } from './institutions-seed';

describe('institution seed (letterheads, BR-2)', () => {
  it('passes validation for both legal entities', () => {
    expect(INSTITUTIONS_SEED.map((i) => i.code)).toEqual(['IMH', 'IDSS']);
    for (const institution of INSTITUTIONS_SEED) {
      const parsed = InstitutionSchema.safeParse(institution);
      expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    }
  });

  it('uses the confirmed IDSS address and registration number (D14)', () => {
    const idss = INSTITUTIONS_SEED.find((i) => i.code === 'IDSS');
    expect(idss?.address).toContain('Buka 13');
    expect(idss?.registrationNumber).toContain('65-05-0013-16');
  });

  it('IBAN digits equal the account digits', () => {
    for (const institution of INSTITUTIONS_SEED) {
      const ibanDigits = institution.iban.replace(/\D/g, '').slice(2);
      expect(ibanDigits).toBe(institution.bankAccount.replace(/\D/g, ''));
    }
  });
});
