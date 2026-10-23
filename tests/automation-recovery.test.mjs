import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as yaml from 'js-yaml';
import { executeRecovery, recoveryTasks, stableSourceId } from '../lib/automation/recovery.mjs';

const receipt = targets => ({ schema: 'career-ops.scan-run@1', scanner: 'portals',
  configSha256: 'config-hash', startedAt: '2026-10-23T00:00:00.000Z', targets });

test('recovery tasks distinguish complete empty sources from incomplete and use stable identities', () => {
  const sourceId = stableSourceId({ scanner: 'portals', name: 'Example', provider: 'greenhouse', scope: { careers_url: 'https://example.test' } });
  const base = { sourceId, name: 'Example', provider: 'greenhouse', configScope: { careers_url: 'https://example.test' } };
  assert.deepEqual(recoveryTasks(receipt([{ ...base, status: 'empty', complete: true }]), { now: 0 }), []);
  const tasks = recoveryTasks(receipt([{ ...base, status: 'error', complete: false, kind: 'server', error: 'HTTP 503' }]), { now: 0 });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].type, 'source_recovery');
  assert.equal(tasks[0].payload.sourceId, sourceId);
  assert.equal(tasks[0].retryAt, new Date(5 * 60_000).toISOString());
  assert.equal(tasks[0].key, recoveryTasks(receipt([{ ...base, status: 'error', complete: false, kind: 'server', error: 'HTTP 503' }]), { now: 0 })[0].key);
});

test('recovery policy honors Retry-After and sends auth, challenge, and structural failures to review', () => {
  const base = { sourceId: 's1', name: 'Example', provider: 'x' };
  const tasks = recoveryTasks(receipt([
    { ...base, status: 'error', complete: false, kind: 'server', retryAfter: '1200' },
    { ...base, sourceId: 's2', status: 'error', complete: false, kind: 'auth', error: 'HTTP 403' },
    { ...base, sourceId: 's3', status: 'error', complete: false, kind: 'unknown', error: 'Captcha challenge' },
    { ...base, sourceId: 's4', status: 'incomplete', complete: false, kind: 'structural', error: 'pagination bound' },
  ]), { now: 0 });
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].retryAt, new Date(1_200_000).toISOString());
});

test('recovery task is exhausted after the two delayed retry slots', () => {
  const task = recoveryTasks(receipt([{ sourceId: 's1', name: 'Example', provider: 'x',
    status: 'error', complete: false, kind: 'network', outerAttempt: 2 }]), { now: 0 })[0];
  assert.equal(task.retryAt, null);
  assert.equal(task.exhausted, true);
  assert.equal(task.requiresReview, true);
});

test('separate scanner runs get separate recovery keys while retry attempts retain a stable source identity', () => {
  const target = { sourceId: 'stable-source', name: 'Example', provider: 'greenhouse',
    status: 'error', complete: false, kind: 'server' };
  const first = recoveryTasks(receipt([target]), { now: 0 })[0];
  const laterReceipt = { ...receipt([target]), startedAt: '2026-10-24T00:00:00.000Z' };
  const later = recoveryTasks(laterReceipt, { now: 0 })[0];
  assert.notEqual(first.key, later.key);
  const retry = recoveryTasks(receipt([{ ...target, outerAttempt: 1 }]), { now: 0 })[0];
  assert.equal(retry.payload.sourceId, first.payload.sourceId);
  assert.equal(retry.payload.outerAttempt, 1);
});

test('executeRecovery uses immutable configPath, preserves run args, and invokes only one source', async () => {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-recovery-'));
  try {
    const effective = { tracked_companies: [{ name: 'Only This One' }], job_boards: [] };
    const base = { tracked_companies: [], job_boards: [] };
    const effectivePath = join(root, 'effective.yml');
    const basePath = join(root, 'portals.yml');
    writeFileSync(effectivePath, yaml.dump(effective));
    writeFileSync(basePath, yaml.dump(base));
    const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const receipt = { ...receiptFor(effective, base), scope: { effectiveConfigPath: effectivePath,
      runArgs: ['--since', '2026-10-01', '--dry-run'] }, targets: [{ sourceId: 'one', name: 'Only This One',
      provider: 'test', status: 'error', complete: false, error: 'HTTP 503', kind: 'server' }] };
    const task = recoveryTasks(receipt, { now: 0 })[0];
    assert.equal(task.payload.configPath, effectivePath);
    let calls = 0;
    const result = await executeRecovery(root, task, { env: { CAREER_OPS_BASE_PORTALS: basePath },
      runScannerFn: async (args) => {
        calls++;
        assert.ok(args.includes('--target-id'));
        assert.ok(args.includes('one'));
        assert.ok(args.includes('--since'));
        assert.ok(args.includes('2026-10-01'));
        const receiptFile = args[args.indexOf('--run-receipt') + 1];
        mkdirSync(join(root, 'data/automation/receipts'), { recursive: true });
        writeFileSync(receiptFile, JSON.stringify({ schema: 'career-ops.scan-run@1', targets: [
          { sourceId: 'one', status: 'success', complete: true, jobs: 1, addedUrls: [] },
        ] }), { flag: 'wx' });
        return { code: 0, stdout: '', stderr: '' };
      } });
    assert.equal(calls, 1);
    assert.equal(result.state, 'completed');
    assert.equal(result.result.target.sourceId, 'one');
    const receiptDir = join(root, 'data/automation/receipts');
    const { readdirSync } = await import('node:fs');
    assert.equal(readdirSync(receiptDir).length, 1, 'attempt receipt is persisted once under a unique name');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('executeRecovery blocks stale base portals before running a retry', async () => {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-stale-base-'));
  try {
    const config = { tracked_companies: [], job_boards: [] };
    const basePath = join(root, 'portals.yml');
    writeFileSync(basePath, 'tracked_companies: []\njob_boards: []\n');
    const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
    const task = { key: 'retry', payload: { scanner: 'portals', sourceId: 'one', outerAttempt: 0,
      configSha256: fingerprint(config), baseConfigSha256: 'stale', runArgs: [] } };
    let called = false;
    const result = await executeRecovery(root, task, { config, env: { CAREER_OPS_BASE_PORTALS: basePath },
      runScannerFn: async () => { called = true; return { code: 0 }; } });
    assert.equal(result.state, 'needs_review');
    assert.equal(result.reason, 'base_source_configuration_changed');
    assert.equal(called, false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('contradictory complete=true error and incomplete outcomes still receive bounded recovery', async t => {
  for (const status of ['error', 'incomplete']) await t.test(status, async () => {
    const root = mkdtempSync(join(tmpdir(), `career-ops-contradictory-${status}-`));
    try {
      const config = { tracked_companies: [], job_boards: [] };
      const basePath = join(root, 'portals.yml');
      writeFileSync(basePath, yaml.dump(config));
      const task = recoveryTasks({ ...receiptFor(config, config), targets: [{ sourceId: 'one', name: 'Example',
        provider: 'test', status, complete: false, kind: 'server', error: 'HTTP 503' }] }, { now: 0 })[0];
      const result = await executeRecovery(root, task, { config, env: { CAREER_OPS_BASE_PORTALS: basePath },
        runScannerFn: async args => {
          const receiptFile = args[args.indexOf('--run-receipt') + 1];
          mkdirSync(join(root, 'data/automation/receipts'), { recursive: true });
          writeFileSync(receiptFile, JSON.stringify({ schema: 'career-ops.scan-run@1', scanner: 'portals',
            runId: status, configSha256: task.payload.configSha256, baseConfigSha256: task.payload.baseConfigSha256,
            targets: [{ sourceId: 'one', name: 'Example', provider: 'test', status, complete: true,
              kind: 'server', error: 'HTTP 503' }] }), { flag: 'wx' });
          return { code: 0, stdout: '', stderr: '' };
        } });
      assert.equal(result.state, 'waiting_retry');
      assert.equal(result.nextPayload.outerAttempt, 1);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
});

test('recovery retries retain the immutable config snapshot and filters across both bounded attempts', async () => {
  const root = mkdtempSync(join(tmpdir(), 'career-ops-retry-chain-'));
  try {
    const effective = { tracked_companies: [{ name: 'Only This One' }], job_boards: [], title_filter: ['Support Engineer'] };
    const base = { tracked_companies: [], job_boards: [] };
    const effectivePath = join(root, 'effective.yml');
    const basePath = join(root, 'portals.yml');
    writeFileSync(effectivePath, yaml.dump(effective));
    writeFileSync(basePath, yaml.dump(base));
    const initialReceipt = { ...receiptFor(effective, base), scope: { effectiveConfigPath: effectivePath,
      runArgs: ['--company', 'Only This One', '--since', '2026-10-01'] }, targets: [{ sourceId: 'one',
      name: 'Only This One', provider: 'test', status: 'error', complete: false, error: 'HTTP 503', kind: 'server' }] };
    let task = recoveryTasks(initialReceipt, { now: 0 })[0];
    const invocations = [];
    for (let outerAttempt = 0; outerAttempt < 2; outerAttempt++) {
      const result = await executeRecovery(root, task, { env: { CAREER_OPS_BASE_PORTALS: basePath },
        runScannerFn: async (args, options) => {
          invocations.push({ args, env: options.env });
          assert.equal(options.env.CAREER_OPS_PORTALS, effectivePath);
          assert.equal(options.env.CAREER_OPS_EFFECTIVE_PORTALS_SNAPSHOT, effectivePath);
          assert.deepEqual(yaml.load(readFileSync(options.env.CAREER_OPS_PORTALS, 'utf8')), effective);
          assert.ok(args.includes('--company'));
          assert.ok(args.includes('Only This One'));
          assert.ok(args.includes('--since'));
          assert.ok(args.includes('2026-10-01'));
          const receiptFile = args[args.indexOf('--run-receipt') + 1];
          const attemptReceipt = { schema: 'career-ops.scan-run@1', scanner: 'portals', runId: `retry-${outerAttempt}`,
            configSha256: initialReceipt.configSha256, baseConfigSha256: initialReceipt.baseConfigSha256,
            scope: { effectiveConfigPath: options.env.CAREER_OPS_EFFECTIVE_PORTALS_SNAPSHOT,
              runArgs: ['--company', 'Only This One', '--since', '2026-10-01'] },
            targets: [{ sourceId: 'one', name: 'Only This One', provider: 'test', status: 'error',
              complete: false, error: 'HTTP 503', kind: 'server' }] };
          mkdirSync(join(root, 'data/automation/receipts'), { recursive: true });
          writeFileSync(receiptFile, JSON.stringify(attemptReceipt), { flag: 'wx' });
          return { code: 1, stdout: '', stderr: 'HTTP 503' };
        } });
      if (outerAttempt === 0) {
        assert.equal(result.state, 'waiting_retry');
        assert.equal(result.nextPayload.outerAttempt, 1);
        assert.equal(result.nextPayload.configPath, effectivePath);
        assert.deepEqual(result.nextPayload.runArgs, initialReceipt.scope.runArgs);
        task = { key: task.key, payload: result.nextPayload };
      } else {
        assert.equal(result.state, 'needs_review');
        assert.equal(result.reason, 'server');
      }
    }
    assert.equal(invocations.length, 2);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function receiptFor(config, base) {
  const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  return { schema: 'career-ops.scan-run@1', scanner: 'portals', runId: 'run-1',
    configSha256: fingerprint(config), baseConfigSha256: fingerprint(base),
    startedAt: '2026-10-23T00:00:00.000Z' };
}
