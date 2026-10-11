import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCanonicalStates, resolveCanonicalState } from '../tracker-utils.mjs';
import { resolveColumns } from '../tracker-parse.mjs';
import { parseTrackerRows } from '../find.mjs';

const states = loadCanonicalStates(new URL('../templates/states.yml', import.meta.url));
test('only canonical status labels and ids resolve', () => {
  for (const s of states) {
    assert.equal(resolveCanonicalState(s.label, states), s.label);
    assert.equal(resolveCanonicalState(s.id.toUpperCase(), states), s.label);
    assert.equal(s.aliases, undefined);
  }
  for (const raw of ['aplicado', 'teklif', 'accepted', 'hold', 'repost', '**Applied**', 'Applied 2026-01-01']) {
    assert.equal(resolveCanonicalState(raw, states), null, raw);
  }
});
test('tracker headers must use the current English schema', () => {
  for (const header of ['| 1 | today | Acme | Engineer | 4/5 | Applied |', '| # | Fecha | Empresa | Puesto | Score | Status |']) {
    assert.throws(() => resolveColumns([header]), /English header/);
  }
  assert.equal(resolveColumns(['| # | Company | Role | Score | Status |']).status, 5);
});

test('an empty tracker has no columns or inferred layout', () => { assert.deepEqual(resolveColumns([]), {}); });

test('lookup resolves report links from the actual tracker directory', () => {
  const header = '| # | Company | Role | Score | Status | Report |';
  const rows = parseTrackerRows([
    header,
    '| 1 | Acme | Engineer | 4 | Applied | [1](../reports/current.md) |',
    '| 2 | Acme | Engineer | 4 | Applied | [2](reports/old.md) |',
  ].join('\n'), '/workspace/data/applications.md');
  assert.equal(rows[0].reportPath, 'reports/current.md');
  assert.equal(rows[1].reportPath, 'data/reports/old.md');
});
