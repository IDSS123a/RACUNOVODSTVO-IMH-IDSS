import { describe, expect, it } from 'vitest';
import {
  BASIS_TEMPLATES,
  CREDIT_MOVE_TEMPLATES,
  CREDIT_NOTE_REASON_TEMPLATES,
  CREDIT_REFUND_TEMPLATES,
  defaultValues,
  formatParam,
  PAYMENT_PURPOSE_TEMPLATES,
  PAYMENT_REFERENCE_TEMPLATES,
  renderTemplate,
  REVERSAL_REASON_TEMPLATES,
  SERVICE_TEMPLATES,
  type TextTemplate,
} from './text-templates';

const byId = (list: ReadonlyArray<TextTemplate>, id: string): TextTemplate => {
  const t = list.find((x) => x.id === id);
  if (!t) throw new Error(id);
  return t;
};

describe('text templates (Director, 2026-11-21: identical syntax for every entry)', () => {
  it('assembles the same text for the same facts', () => {
    expect(renderTemplate(byId(PAYMENT_PURPOSE_TEMPLATES, 'tuition'), { mjesec: 'decembar', godina: '2026' })).toBe('Uplata školarine za decembar 2026');
    expect(renderTemplate(byId(PAYMENT_REFERENCE_TEMPLATES, 'statement'), { broj: '245', datum: '2026-12-03' })).toBe('Izvod br. 245 od 03.12.2026.');
    expect(renderTemplate(byId(SERVICE_TEMPLATES, 'summer'), { godina: '2027', sedmica: '2' })).toBe('Ljetna škola 2027 — 2. sedmica');
    expect(renderTemplate(byId(BASIS_TEMPLATES, 'uo'), { broj: '12/26', datum: '2026-06-01' })).toBe('Odluka UO IMH br. 12/26 od 01.06.2026.');
    expect(renderTemplate(byId(CREDIT_NOTE_REASON_TEMPLATES, 'withdrawal'), { datum: '2026-10-15' })).toBe('Ispis djeteta od 15.10.2026.');
    expect(renderTemplate(byId(CREDIT_NOTE_REASON_TEMPLATES, 'duplicate'), {})).toBe('Dupli račun za isti period');
    expect(renderTemplate(byId(CREDIT_MOVE_TEMPLATES, 'move'), { racun: 'IMH-012/26' })).toBe('Prenos preplate na račun IMH-012/26');
    expect(renderTemplate(byId(CREDIT_REFUND_TEMPLATES, 'refund'), { broj: '9', datum: '2026-11-30' })).toBe('Povrat preplate uplatiocu, izvod br. 9 od 30.11.2026.');
    // extra spaces typed by the operator never change the text
    expect(renderTemplate(byId(SERVICE_TEMPLATES, 'trip'), { naziv: '  Zoo   vrt ', datum: '2027-05-10' })).toBe('Izlet — Zoo vrt (10.05.2027.)');
  });

  it('a missing or malformed field gives no text at all (the entry cannot be saved)', () => {
    const tuition = byId(PAYMENT_PURPOSE_TEMPLATES, 'tuition');
    expect(renderTemplate(tuition, { mjesec: 'Decembar', godina: '2026' })).toBeNull();
    expect(renderTemplate(tuition, { mjesec: 'decembar', godina: '26' })).toBeNull();
    expect(renderTemplate(tuition, { mjesec: 'decembar' })).toBeNull();
    expect(formatParam('schoolYear', '2026/2028')).toBeNull();
    expect(formatParam('schoolYear', '2026/2027')).toBe('2026/2027');
    expect(formatParam('date', '15.10.2026')).toBeNull();
    expect(formatParam('count', '0')).toBeNull();
    expect(formatParam('number', 'br. 12')).toBeNull();
    expect(formatParam('text', 'x'.repeat(61))).toBeNull();
    expect(formatParam('text', 'Ostalo {x}')).toBeNull();
  });

  it('defaults: current month, year, school year and today; known values win', () => {
    const tuition = byId(PAYMENT_PURPOSE_TEMPLATES, 'tuition');
    expect(defaultValues(tuition, '2026-11-21')).toEqual({ mjesec: 'novembar', godina: '2026' });
    expect(defaultValues(byId(PAYMENT_PURPOSE_TEMPLATES, 'enrolment'), '2027-03-02')).toEqual({ skolska: '2026/2027' });
    expect(defaultValues(byId(PAYMENT_PURPOSE_TEMPLATES, 'invoice'), '2026-11-21', { racun: 'IMH-001/26' })).toEqual({ racun: 'IMH-001/26' });
    expect(defaultValues(byId(REVERSAL_REASON_TEMPLATES, 'returned'), '2026-11-21')).toEqual({ datum: '2026-11-21' });
  });

  it('every template renders with its defaults filled, and ids are unique per list', () => {
    const lists = [SERVICE_TEMPLATES, BASIS_TEMPLATES, PAYMENT_PURPOSE_TEMPLATES, PAYMENT_REFERENCE_TEMPLATES, CREDIT_NOTE_REASON_TEMPLATES, REVERSAL_REASON_TEMPLATES, CREDIT_MOVE_TEMPLATES, CREDIT_REFUND_TEMPLATES];
    const sample: Record<string, string> = { naziv: 'Test', opis: 'Test', ime: 'Ana Test', broj: '1', racun: 'IMH-001/26', sedmica: '1' };
    for (const list of lists) {
      expect(new Set(list.map((t) => t.id)).size).toBe(list.length);
      for (const t of list) expect(renderTemplate(t, defaultValues(t, '2026-11-21', sample)), t.id).not.toBeNull();
    }
  });
});
