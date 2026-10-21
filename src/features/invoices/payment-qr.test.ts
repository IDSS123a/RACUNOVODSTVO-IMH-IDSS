import { describe, expect, it } from 'vitest';
import { epcPayload, qrMatrix } from './payment-qr';

const BASE = {
  bic: 'ABSBBA22',
  payeeName: 'P.P.U. International Montessori House',
  iban: 'BA39 1990 4900 5848 7943',
  amount: 193000,
  remittance: 'Račun IMH-001/26 Đurđa Čolić-Šećić',
};

describe('provisional payment QR (EPC format, BAM)', () => {
  it('builds the EPC payload with BAM amount and compact IBAN', () => {
    expect(epcPayload(BASE).split('\n')).toEqual([
      'BCD', '002', '1', 'SCT', 'ABSBBA22', 'P.P.U. International Montessori House', 'BA391990490058487943', 'BAM1930.00', '', '', 'Račun IMH-001/26 Đurđa Čolić-Šećić',
    ]);
    expect(epcPayload({ ...BASE, amount: 5 })).toContain('BAM0.05');
  });

  it('respects the EPC length limits (name 70, text 140)', () => {
    const lines = epcPayload({ ...BASE, payeeName: 'X'.repeat(100), remittance: 'Y'.repeat(200) }).split('\n');
    expect(lines[5]).toHaveLength(70);
    expect(lines[10]).toHaveLength(140);
  });

  it('refuses invalid IBAN, BIC and amounts', () => {
    expect(() => epcPayload({ ...BASE, iban: 'HR12 3456' })).toThrow();
    expect(() => epcPayload({ ...BASE, bic: 'abc' })).toThrow();
    expect(() => epcPayload({ ...BASE, amount: 0 })).toThrow();
  });

  it('produces a square module matrix', () => {
    const matrix = qrMatrix(epcPayload(BASE));
    expect(matrix.length).toBeGreaterThan(20);
    expect(matrix.every((row) => row.length === matrix.length)).toBe(true);
  });
});
