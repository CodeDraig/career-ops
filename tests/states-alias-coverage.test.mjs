import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeStatus } from '../normalize-statuses.mjs';

test('normalizer rejects legacy aliases and decorated statuses', () => {
 for (const raw of ['hold', 'verificar', 'condicional', 'evaluar', 'geo blocker', 'geo_blocker', 'geoblocker', 'rechazado 2026', 'aplicado 2026', '**Rechazado**', 'screening', 'accepted']) {
  assert.deepEqual(normalizeStatus(raw), { status: null, unknown: true }, raw);
 }
});
test('normalizer still fixes the casing of canonical labels', () => {
 assert.deepEqual(normalizeStatus('applied'), { status: 'Applied' });
 assert.deepEqual(normalizeStatus('hired'), { status: 'Hired' });
});
