import { describe, expect, it } from 'vitest';
import { correctedValue, isRealDate, normalizeEmail, normalizeName, normalizePhone } from './formats';

/**
 * Every example of the Director's proposal „Parent / Payer Registration — Master QA Standard“ (2026-11-27), row by
 * row, as approved in specs/registration-validation/SPEC.md. A row that changes its result fails here.
 */
describe('proposal §1: names', () => {
  it.each([
    ['amir', 'Amir', true], // corrected, and the correction is shown (A7)
    ['BEGOVIĆ', 'Begović', true],
    ['Begović', 'Begović', false],
    ['  Amir ', 'Amir', false], // only spaces trimmed: not reported as a correction
    ['Ana  Maria', 'Ana Maria', true],
    ['Jean-Pierre', 'Jean-Pierre', false],
    ['Van der Berg', 'Van der Berg', false], // A6: the particle keeps its lower case
    ['van der Berg', 'Van der Berg', true], // the first word of a name is capitalised
    ['Ludwig van Beethoven', 'Ludwig van Beethoven', false],
    ['José', 'José', false],
    ['María', 'María', false], // A5
    ['Ramón', 'Ramón', false],
    ['Łukasz', 'Łukasz', false],
    ['Şahin', 'Şahin', false],
    ['Müller', 'Müller', false],
    ["O'Neil", "O'Neil", false],
    ['McKenzie', 'McKenzie', false],
    ['Đurđa Čolić-Šećić', 'Đurđa Čolić-Šećić', false],
  ])('%s → %s', (typed, saved, shown) => {
    expect(normalizeName(typed)).toBe(saved);
    expect(correctedValue(typed, normalizeName) !== null).toBe(shown);
  });

  it.each(['Amir123', 'Beg!ović', '', '   ', '-Ana', 'Ana--Maria'])('%j is refused', (typed) => {
    expect(normalizeName(typed)).toBeNull();
  });
});

describe('proposal §2/§4/§6: dates', () => {
  it.each([
    ['1985-06-15', true],
    ['1985-02-31', false],
    ['1984-02-29', true],
    ['1985-02-29', false],
    ['1985-13-01', false],
    ['', false],
  ])('%s → %s', (date, valid) => expect(isRealDate(date)).toBe(valid));
});

describe('proposal §8: telephone', () => {
  it.each([
    ['+387 61 123 456', '+387 61 123 456'],
    ['061123456', '+387 61 123 456'],
    ['+387-61-123-456', '+387 61 123 456'],
    ['+387 61 ABC 456', null],
    ['123', null],
    ['+387 000 000 000', null],
    ['+387 61 111 111', null], // A8: one repeated digit
    ['033 000 000', null],
    ['+49 176 1234 5678', '+4917612345678'],
    ['+49 111 1111 1111', null],
  ])('%s → %s', (typed, saved) => expect(normalizePhone(typed)).toBe(saved));
});

describe('proposal §9: e-mail', () => {
  it.each([
    ['parent@example.com', 'parent@example.com'],
    ['  Parent@Example.COM ', 'parent@example.com'],
    ['parent@', null],
    ['parent.example.com', null],
    ['parent @example.com', null],
    ['parent@example', null],
    ['parent@example.com.', null],
  ])('%s → %s', (typed, saved) => expect(normalizeEmail(typed)).toBe(saved));
});
