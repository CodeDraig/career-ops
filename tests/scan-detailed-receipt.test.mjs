import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { sourceConfigScope, stableSourceId } from '../lib/automation/recovery.mjs';
import { parseArgs as parseFullScanArgs } from '../scan-ats-full.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
function run(root, args) {
  return spawnSync(process.execPath, [join(ROOT, 'scan.mjs'), ...args], { cwd: root,
    env: { ...process.env, CAREER_OPS_ROOT: root, CAREER_OPS_PORTALS: join(root, 'portals.yml'),
      CAREER_OPS_PROFILE: join(root, 'config/profile.yml'), CAREER_OPS_PIPELINE: join(root, 'data/pipeline.md'),
      CAREER_OPS_SCAN_HISTORY: join(root, 'data/scan-history.tsv') }, encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 });
}

test('detailed receipt is additive and target-only retry resolves one exact configured entry', () => {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-run-receipt-'));
  try {
    mkdirSync(join(root, 'data'), { recursive: true });
    mkdirSync(join(root, 'config'), { recursive: true });
    writeFileSync(join(root, 'config/profile.yml'), '{}\n');
    const entry = { name: 'Receipt Fixture', careers_url: 'https://boards.example.com/fixture',
      parser: { command: 'node', script: 'tests/fixtures/three-city-board.mjs' } };
    writeFileSync(join(root, 'portals.yml'), `tracked_companies:\n  - name: Receipt Fixture\n    careers_url: https://boards.example.com/fixture\n    parser:\n      command: node\n      script: tests/fixtures/three-city-board.mjs\n  - name: Another Fixture\n    careers_url: https://boards.example.com/another\n    parser:\n      command: node\n      script: tests/fixtures/three-city-board.mjs\njob_boards: []\n`);
    const sourceId = stableSourceId({ scanner: 'portals', name: entry.name, provider: 'local-parser', scope: sourceConfigScope(entry) });
    const receiptPath = join(root, 'data/run.json');
    const result = run(root, ['--dry-run', '--json', '--run-receipt', receiptPath, '--target-id', sourceId]);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).scanned, 1, 'legacy stdout receipt remains the same shape and reports selected target');
    const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
    assert.equal(receipt.schema, 'career-ops.scan-run@1');
    assert.equal(receipt.targets.length, 1);
    assert.equal(receipt.targets[0].sourceId, sourceId);
    assert.equal(receipt.targets[0].name, 'Receipt Fixture');
    assert.equal(receipt.targets[0].complete, true);
    assert.ok(Array.isArray(receipt.targets[0].addedUrls));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('full ATS scanner accepts a detailed receipt path and exact source selector', () => {
  const opts = parseFullScanArgs(['node', 'scan-ats-full.mjs', '--ats', 'workday',
    '--run-receipt', '/tmp/run.json', '--target-source-id', 'source-123']);
  assert.equal(opts.runReceipt, '/tmp/run.json');
  assert.equal(opts.targetSourceId, 'source-123');
  assert.deepEqual(opts.ats, ['workday']);
});
