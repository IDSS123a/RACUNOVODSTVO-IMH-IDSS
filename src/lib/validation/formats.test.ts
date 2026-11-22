import { describe, expect, it } from 'vitest';
import { INSTITUTIONS_SEED } from '@/features/settings/institutions-seed';
import {
  isRealDate,
  normalizeAddress,
  normalizeBankAccount,
  normalizeDocumentNumber,
  normalizeEmail,
  normalizeFullName,
  normalizeIban,
  normalizeJib,
  normalizeName,
  normalizePhone,
  normalizeRegistration,
  normalizeSwift,
  normalizeText,
  normalizeWebsite,
  phoneField,
} from './formats';
import { GuardianFormSchema, InstitutionFormSchema } from './schemas';

describe('one canonical format per value (Director, 2026-11-21)', () => {
  it('telephone: every way of typing the same number gives the same text', () => {
    for (const typed of ['033562114', '033/562-114', '033 562 114', '+387 33 562 114', '+387/33 562-114', '00387 33 562114', '(033) 562.114']) {
      expect(normalizePhone(typed), typed).toBe('+387 33 562 114');
    }
    expect(normalizePhone('060 345 1275')).toBe('+387 60 345 1275');
    expect(normalizePhone('061-234-567')).toBe('+387 61 234 567');
    expect(normalizePhone('+49 176 1234 5678')).toBe('+4917612345678');
    expect(normalizePhone('0049 176 1234 5678')).toBe('+4917612345678');
    for (const bad of ['562114', '033 56', '+387 99 562 114', '+387 33 562 11425', 'tel 033562114', '']) expect(normalizePhone(bad), bad).toBeNull();
  });

  it('names: capital initial, single spaces, hyphen without spaces; digits rejected; mixed case kept', () => {
    expect(normalizeName('  ana   marija ')).toBe('Ana Marija');
    expect(normalizeName('BEGIĆ - HODŽIĆ')).toBe('Begić-Hodžić');
    expect(normalizeName('đurđa')).toBe('Đurđa');
    expect(normalizeName('McKenzie')).toBe('McKenzie');
    expect(normalizeName("o’Neil")).toBe("O'Neil");
    expect(normalizeName('Ana2')).toBeNull();
    expect(normalizeFullName('amra begić')).toBe('Amra Begić');
    expect(normalizeFullName('Amra')).toBeNull();
  });

  it('e-mail, web, SWIFT, JIB', () => {
    expect(normalizeEmail('  Info@IDSS.ba ')).toBe('info@idss.ba');
    expect(normalizeEmail('info@idss')).toBeNull();
    expect(normalizeWebsite('https://WWW.idss.edu.ba/')).toBe('www.idss.edu.ba');
    expect(normalizeWebsite('idss')).toBeNull();
    expect(normalizeSwift('absb ba22')).toBe('ABSBBA22');
    expect(normalizeSwift('ABSB')).toBeNull();
    expect(normalizeJib('4201731140006')).toBe('4201731140006');
    expect(normalizeJib('42017311')).toBeNull();
  });

  it('IBAN and transaction account: check digits verified, grouped by four', () => {
    expect(normalizeIban('ba391990490058487943')).toBe('BA39 1990 4900 5848 7943');
    expect(normalizeIban('BA39-1994-9900-2180-9884')).toBe('BA39 1994 9900 2180 9884');
    expect(normalizeIban('BA38 1990 4900 5848 7943')).toBeNull();
    expect(normalizeIban('DE89370400440532013000')).toBeNull();
    expect(normalizeBankAccount('1990490058487943')).toBe('1990 4900 5848 7943');
    expect(normalizeBankAccount('1990490058487944')).toBeNull();
  });

  it('the institutions master data already passes (letterheads, BR-2)', () => {
    for (const i of INSTITUTIONS_SEED) {
      expect(normalizeIban(i.iban), i.code).toBe(i.iban);
      expect(normalizeBankAccount(i.bankAccount), i.code).toBe(i.bankAccount);
      expect(normalizeSwift(i.swift)).toBe(i.swift);
      expect(normalizeJib(i.taxId)).toBe(i.taxId);
      expect(normalizeEmail(i.email)).toBe(i.email);
      expect(normalizeWebsite(i.website)).toBe(i.website);
      expect(normalizeRegistration(i.registrationNumber)).toBe(i.registrationNumber);
      for (const phone of [i.phone, i.fax, i.mobile].filter(Boolean)) expect(normalizePhone(phone), phone).toBe(phone);
    }
  });

  it('address: comma spacing, 5-digit postal code, house number or „bb“ required', () => {
    expect(normalizeAddress('buka 11,71 000   sarajevo')).toBe('Buka 11, 71000 Sarajevo');
    expect(normalizeAddress('Buka 11, 71 000 Sarajevo, Bosna i Hercegovina')).toBe('Buka 11, 71000 Sarajevo, Bosna i Hercegovina');
    expect(normalizeAddress('Gornji Kotorac BB, 71000 Sarajevo')).toBe('Gornji Kotorac bb, 71000 Sarajevo');
    expect(normalizeAddress('Sarajevo')).toBeNull();
  });

  it('document numbers, registration, short text, dates', () => {
    expect(normalizeDocumentNumber(' 02-1-123 / 26 ')).toBe('02-1-123/26');
    expect(normalizeDocumentNumber('br. 12')).toBeNull();
    expect(normalizeRegistration('MBSU  65-05-0013-16')).toBe('MBSU 65-05-0013-16');
    expect(normalizeRegistration('65-05-13')).toBeNull();
    expect(normalizeText('  Računovođa  ', 60)).toBe('Računovođa');
    expect(normalizeText('<b>x</b>', 60)).toBeNull();
    expect(isRealDate('2026-02-29')).toBe(false);
    expect(isRealDate('2028-02-29')).toBe(true);
  });

  it('form fields: an optional field stays empty, a typed value is saved only in canonical form', () => {
    expect(phoneField().parse('')).toBe('');
    expect(phoneField().parse('033/562-114')).toBe('+387 33 562 114');
    const bad = phoneField().safeParse('033');
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0]?.message).toContain('+387 33 562 114');
  });

  it('form schemas: the institutions seed saves in canonical form; a guardian typed loosely is saved canonically', () => {
    for (const i of INSTITUTIONS_SEED) {
      const parsed = InstitutionFormSchema.safeParse(i);
      expect(parsed.success, i.code).toBe(true);
      if (parsed.success) expect(parsed.data.address).toContain('71000 Sarajevo');
    }
    const guardian = GuardianFormSchema.parse({
      id: '00000000-0000-4000-8000-000000000001', familyId: '00000000-0000-4000-8000-000000000002',
      fullName: '  amra   begić ', role: 'MOTHER', email: ' Amra@Mail.BA ', phone: '061/234-567', iban: 'ba391990490058487943', isPayer: true,
    });
    expect(guardian).toMatchObject({ fullName: 'Amra Begić', email: 'amra@mail.ba', phone: '+387 61 234 567', iban: 'BA39 1990 4900 5848 7943' });
    expect(GuardianFormSchema.safeParse({ ...guardian, phone: '234-567' }).success).toBe(false);
  });
});

describe('unit of measure: proposed or typed differently (Director, 2026-11-22)', () => {
  it('accepts the proposals and any short unit in lower case; refuses digits, empty and too long', async () => {
    const { normalizeUnit } = await import('./formats');
    expect(['srv', 'kom', 'sedm.', 'dan', 'mj.', 'čas'].map(normalizeUnit)).toEqual(['srv', 'kom', 'sedm.', 'dan', 'mj.', 'čas']);
    expect(normalizeUnit('  Sedmica ')).toBe('sedmica');
    expect(normalizeUnit('sat')).toBe('sat');
    expect(normalizeUnit('')).toBeNull();
    expect(normalizeUnit('12')).toBeNull();
    expect(normalizeUnit('sedmicaaaaa')).toBeNull();
  });
});
