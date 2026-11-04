import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SET_UPDATABLE_FIELDS, isSetUpdatableField } from './setFields';

const rulesFile = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../firestore.rules'
);

/** The field list of the sets update rule's affectedKeys().hasOnly([...]). */
function rulesUpdatableFields(): string[] {
  const rules = readFileSync(rulesFile, 'utf8');
  const setsBlock = rules.slice(rules.indexOf('match /sets/{setId}'));
  const m = setsBlock.match(/affectedKeys\(\)\.hasOnly\(\[([^\]]*)\]\)/);
  if (!m) throw new Error('sets update rule not found in firestore.rules');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

describe('SET_UPDATABLE_FIELDS', () => {
  it("matches the sets update rule's affectedKeys in firestore.rules", () => {
    expect([...SET_UPDATABLE_FIELDS].sort()).toEqual(rulesUpdatableFields().sort());
  });

  it('leaves out what only a create may set', () => {
    for (const f of ['userId', 'createdAt', 'addedAt', 'setNumber']) {
      expect(isSetUpdatableField(f)).toBe(false);
    }
    expect(isSetUpdatableField('marketPrices')).toBe(true);
  });
});
