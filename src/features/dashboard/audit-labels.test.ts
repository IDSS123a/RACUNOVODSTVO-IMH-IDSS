import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ACTION_LABEL, actionLabel, ENTITY_LABEL, entityLabel, objectText } from './audit-labels';

/** Every `audit(tx, ACTION, ENTITY, …)` call of the backend, with `if … { "A" } else { "B" }` actions expanded. */
function auditCalls(): Array<{ action: string; entity: string }> {
  const dir = resolve(__dirname, '../../../src-tauri/src');
  const calls: Array<{ action: string; entity: string }> = [];
  const pattern = /audit\(\s*&?tx,\s*(?:if [^{]*\{\s*"([A-Z_]+)"\s*\}\s*else\s*\{\s*"([A-Z_]+)"\s*\}|"([A-Z_]+)"),\s*"([a-z_]+)"/g;
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.rs'))) {
    const source = readFileSync(resolve(dir, file), 'utf8');
    for (const m of source.matchAll(pattern)) {
      const entity = m[4] ?? '';
      for (const action of [m[1], m[2], m[3]]) if (action) calls.push({ action, entity });
    }
  }
  return calls;
}

describe('audit-log labels (BR-30)', () => {
  it('finds the backend audit calls (the scan itself works)', () => {
    const calls = auditCalls();
    expect(calls.length).toBeGreaterThan(20);
    expect(calls).toContainEqual({ action: 'ISSUE', entity: 'invoice' });
    expect(calls).toContainEqual({ action: 'BREAKFAST_OFF', entity: 'enrolment' });
  });

  it('every action and entity written by the backend has a Bosnian label', () => {
    const calls = auditCalls();
    expect(calls.filter((c) => !(c.action in ACTION_LABEL)).map((c) => c.action)).toEqual([]);
    expect(calls.filter((c) => !(c.entity in ENTITY_LABEL)).map((c) => c.entity)).toEqual([]);
  });

  it('an unknown code is shown as it is, never hidden', () => {
    expect(actionLabel('NEW_THING')).toBe('NEW_THING');
    expect(entityLabel('thing')).toBe('thing');
    expect(actionLabel('ISSUE')).toBe('Izdat račun');
  });

  it('the object reads as kind and name; a deleted named record says so; others show their id', () => {
    expect(objectText({ entity: 'invoice', entityId: 'x', subject: 'IMH-001/26' })).toBe('Račun: IMH-001/26');
    expect(objectText({ entity: 'family', entityId: 'gone', subject: null })).toBe('Porodica (obrisano)');
    expect(objectText({ entity: 'board_rules', entityId: 'IMH 2026/2027', subject: null })).toBe('Pravila naplate (odbor): IMH 2026/2027');
    expect(objectText({ entity: 'database', entityId: '', subject: null })).toBe('Baza podataka');
  });
});
