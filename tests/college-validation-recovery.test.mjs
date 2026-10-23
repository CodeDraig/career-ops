import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildCoverageOverlay, classifySearch, failedSchoolsForRetry } from '../container/validate-colleges.mjs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));

test('college search keeps a valid empty result separate from truncated pagination', () => {
  assert.equal(classifySearch([], []), 'empty');
  assert.throws(() => classifySearch([], ['pagination incomplete after page 2']), /partial or failed pagination/);
  assert.throws(() => classifySearch([{ title: 'Role', url: 'https://jobs.test/1' }], ['stopped at 2 pages']), /partial or failed pagination/);
});

test('failed-only retry selection checks the inventory fingerprint and ignores complete/unsupported results', () => {
  const summary = { inventorySha256: 'same', schools: [
    { unitid: '000001', status: 'error', complete: false },
    { unitid: '000002', status: 'empty', complete: true },
    { unitid: '000003', status: 'unresolved', complete: false },
  ] };
  assert.deepEqual(failedSchoolsForRetry(summary, 'same').map(row => row.unitid), ['000001']);
  assert.throws(() => failedSchoolsForRetry(summary, 'different'), /does not match/);
});

test('coverage overlay preserves original result and records failed retry separately', () => {
  const original = { inventorySha256: 'hash', schools: [
    { unitid: '000001', status: 'error', complete: false, reason: 'temporary failure' },
    { unitid: '000002', status: 'empty', complete: true },
  ] };
  const recovered = [{ unitid: '000001', status: 'working', complete: true, postings: 12 }];
  const overlay = buildCoverageOverlay(original, recovered, { path: '/tmp/original-summary.json', sha256: 'receipt' });
  assert.equal(original.schools[0].status, 'error');
  assert.equal(overlay.schools[0].status, 'error');
  assert.equal(overlay.schools[0].effectiveStatus, 'working');
  assert.deepEqual(overlay.counts, { working: 1, empty: 1, unresolved: 0, error: 0 });
  assert.equal(overlay.coveragePercent, 100);
});

test('failed-only recovery CLI parses its dashed flags before Docker prerequisite check', () => {
  const result = spawnSync(process.execPath, [join(root, 'container/validate-colleges.mjs'),
    '--inventory', '/tmp/inventory.json', '--output', '/tmp/original', '--retry-failed',
    '--recovery-output', '/tmp/recovery'], { cwd: root, encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Run this validation inside Docker/);
  assert.doesNotMatch(result.stderr, /Unknown option|ERR_PARSE_ARGS_UNKNOWN_OPTION/);
});

test('college validation exposes both long and short help flags', () => {
  for (const flag of ['--help', '-h']) {
    const result = spawnSync(process.execPath, [join(root, 'container/validate-colleges.mjs'), flag],
      { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /--retry-failed --recovery-output/);
  }
});
