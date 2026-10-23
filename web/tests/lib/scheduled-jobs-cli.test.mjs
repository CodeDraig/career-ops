import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import * as yaml from 'js-yaml';
import { main } from '../../scripts/scheduled-jobs-runner.mjs';
import { readState } from '../../../lib/automation/store.mjs';

const sha = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

test('scheduled runner CLI entry uses one async scan, persists receipt snapshot and queues source recovery', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-ops-scheduled-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const storePath = path.join(root, 'data', 'scheduled-jobs.json');
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(path.join(root, 'portals.yml'), 'title_filter:\n  positive: [engineer]\nlocation_filter: {}\n');
  const now = new Date(Date.now() - 60_000).toISOString();
  const jobId = '11111111-1111-4111-8111-111111111111';
  fs.writeFileSync(storePath, JSON.stringify({ jobs: [{ id: jobId, name: 'CLI scan', status: 'active', engine: 'full', filters: { positive: ['designer'], blockHard: ['Brazil'] }, timezone: 'UTC', startAt: now, every: 1, unit: 'hours', createdAt: now, updatedAt: now }], runs: [], queue: [] }));

  let childRuns = 0, savedReceipt;
  const result = await main([], { root, spawnFn: async (_node, args, options) => {
    childRuns++;
    assert.equal(args.filter(arg => arg === '--run-receipt').length, 1);
    assert.ok(options.env.CAREER_OPS_EFFECTIVE_PORTALS_SNAPSHOT);
    const effective = yaml.load(fs.readFileSync(options.env.CAREER_OPS_EFFECTIVE_PORTALS_SNAPSHOT, 'utf8'));
    const base = yaml.load(fs.readFileSync(options.env.CAREER_OPS_BASE_PORTALS, 'utf8'));
    const source = { name: 'Fixture employer', provider: 'workday', scope: { entrySha256: 'fixture' } };
    const receipt = {
      schema: 'career-ops.scan-run@1', scanner: 'ats-full', runId: 'cli-fixture-run',
      startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
      configSha256: sha(effective), baseConfigSha256: sha(base),
      scope: { runArgs: args.slice(1, args.indexOf('--run-receipt')), effectiveConfigPath: options.env.CAREER_OPS_EFFECTIVE_PORTALS_SNAPSHOT },
      targets: [{ ...source, sourceId: 'fixture-workday-board', configScope: source.scope, status: 'error', complete: false, jobs: 0, addedUrls: [], warnings: [], error: 'HTTP 503', kind: 'server', statusCode: 503, retryAfter: null }],
    };
    savedReceipt = args[args.indexOf('--run-receipt') + 1];
    fs.writeFileSync(savedReceipt, JSON.stringify(receipt));
    return { status: 0, stdout: JSON.stringify({ postingsKept: 2 }), stderr: '' };
  } });

  assert.equal(childRuns, 1, 'CLI scan invokes one scanner attempt; source failure is not a whole-sweep retry');
  assert.equal(result.status, 'success');
  assert.equal(result.jobId, jobId);
  assert.ok(fs.existsSync(savedReceipt));
  assert.ok(fs.existsSync(JSON.parse(fs.readFileSync(savedReceipt, 'utf8')).scope.effectiveConfigPath));
  const state = readState(root);
  assert.equal(state.tasks.length, 1);
  assert.equal(state.tasks[0].type, 'source_recovery');
  assert.equal(state.tasks[0].payload.sourceId, 'fixture-workday-board');
  assert.equal(state.tasks[0].payload.configPath, JSON.parse(fs.readFileSync(savedReceipt, 'utf8')).scope.effectiveConfigPath);
  assert.deepEqual(state.tasks[0].payload.runArgs, ['--since', '7', '--ats', 'greenhouse,lever,ashby,workday', '--limit', '150', '--json']);
  assert.equal(state.tasks[0].state, 'retry_waiting');
});

test('scheduled runner marks a missing detailed receipt failed and creates a source-repair review', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-ops-scheduled-cli-missing-receipt-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const storePath = path.join(root, 'data', 'scheduled-jobs.json');
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(path.join(root, 'portals.yml'), 'title_filter:\n  positive: [engineer]\nlocation_filter: {}\n');
  const now = new Date(Date.now() - 60_000).toISOString();
  const jobId = '11111111-1111-4111-8111-111111111112';
  fs.writeFileSync(storePath, JSON.stringify({ jobs: [{ id: jobId, name: 'Missing receipt fixture', status: 'active', engine: 'full', filters: { positive: ['designer'] }, timezone: 'UTC', startAt: now, every: 1, unit: 'hours', createdAt: now, updatedAt: now }], runs: [], queue: [] }));

  const result = await main([], { root, spawnFn: async (_node, _args, options) => {
    assert.ok(options.env.CAREER_OPS_EFFECTIVE_PORTALS_SNAPSHOT);
    return { status: 0, stdout: JSON.stringify({ postingsKept: 0 }), stderr: '' };
  } });

  assert.equal(result.status, 'failed');
  assert.match(result.message, /before writing its source receipt/);
  const state = readState(root);
  assert.equal(state.tasks.length, 0);
  assert.equal(state.reviews.length, 1);
  assert.equal(state.reviews[0].type, 'source_repair');
  assert.match(state.reviews[0].payload.reason, /before writing its source receipt/);
  const persisted = JSON.parse(fs.readFileSync(storePath, 'utf8'));
  assert.equal(persisted.runs[0].state, 'failed', 'scheduled history records receipt failure rather than scan success');
});

test('scheduled runner does not count malformed receipt JSON as a successful scan', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-ops-scheduled-cli-malformed-receipt-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const storePath = path.join(root, 'data', 'scheduled-jobs.json');
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(path.join(root, 'portals.yml'), 'title_filter:\n  positive: [engineer]\nlocation_filter: {}\n');
  const now = new Date(Date.now() - 60_000).toISOString();
  const jobId = '11111111-1111-4111-8111-111111111113';
  fs.writeFileSync(storePath, JSON.stringify({ jobs: [{ id: jobId, name: 'Malformed receipt fixture', status: 'active', engine: 'full', filters: { positive: ['designer'] }, timezone: 'UTC', startAt: now, every: 1, unit: 'hours', createdAt: now, updatedAt: now }], runs: [], queue: [] }));

  const result = await main([], { root, spawnFn: async (_node, args) => {
    const receiptPath = args[args.indexOf('--run-receipt') + 1];
    fs.writeFileSync(receiptPath, '{broken-json');
    return { status: 0, stdout: JSON.stringify({ postingsKept: 0 }), stderr: '' };
  } });

  assert.equal(result.status, 'failed');
  assert.match(result.message, /invalid JSON/);
  const state = readState(root);
  assert.equal(state.reviews.length, 1);
  assert.match(state.reviews[0].payload.reason, /invalid JSON/);
  assert.equal(JSON.parse(fs.readFileSync(storePath, 'utf8')).runs[0].state, 'failed');
});
