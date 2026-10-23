import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { addReview, claimTask, enqueueTask, readState, reserveBudget, writeConfig } from '../lib/automation/store.mjs';
import { ingestReceipt, runAiTick, runScanTick, workerOnce } from '../lib/automation/worker.mjs';
import { withResourceLock } from '../web/src/lib/scheduled-jobs-store.mjs';
import { scheduledRunnerResourcePath, scheduledStorePath } from '../web/src/lib/scheduled-runner-path.mjs';
import { localDay } from '../lib/automation/service.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-automation-worker-'));
  for (const relative of ['config/profile.yml', 'modes/_profile.md', 'cv.md', 'portals.yml']) {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), relative === 'portals.yml' ? 'companies: []\n' : `fixture ${relative}\n`);
  }
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

const config = { enabled: true, paused: false, timezone: 'America/New_York', dailyRoles: 20, dailyDrafts: 20, newSlots: 10, backlogSlots: 10, mailAccounts: [], model: '', effort: '' };
function services({ discovered = [], roleOutcome, mailTasks = [], mailOutcome, calls = {} } = {}) {
  return {
    discoverPipeline: async () => discovered,
    pipelinePreflight: async () => ({ ok: true, inputFingerprint: 'fingerprint-1' }),
    executeRole: async (...args) => { calls.role = (calls.role || 0) + 1; return roleOutcome ?? { state: 'review_ready', aiStarted: true, result: { packet: 'ready' }, checkpoint: { stage: 'done' } }; },
    runScheduledTick: async () => { calls.scan = (calls.scan || 0) + 1; return { status: 'idle' }; },
    pollMail: async () => { calls.poll = (calls.poll || 0) + 1; return { tasks: mailTasks, reviews: [], summary: { polled: 0 } }; },
    executeMailDraft: async () => { calls.draft = (calls.draft || 0) + 1; return mailOutcome ?? { state: 'review_ready', aiStarted: true, result: { draft: 'ready' } }; },
    executeRecovery: async () => ({ state: 'completed' }),
    recoveryTasks: () => [],
    checkCodexLogin: async () => ({ ok: true }),
    calls,
  };
}

test('worker once uses injected services, prepares a role packet once, and resumes idempotently', async t => {
  const root = fixture(t); await writeConfig(root, { ...config });
  const now = new Date();
  const calls = {};
  const impl = services({ discovered: [{ key: 'role:https://jobs.example.test/1', cohort: 'backlog', payload: { url: 'https://jobs.example.test/1' } }], calls });
  const first = await workerOnce(root, { services: impl, now });
  assert.equal(first.status, 'finished');
  assert.equal(calls.role, 1);
  assert.equal(calls.poll, 1);
  assert.equal(calls.scan, 1);
  assert.equal(readState(root).digests.filter(digest => digest.day === localDay(now, config.timezone)).length, 1, 'the morning run writes one local-day digest');
  assert.equal(readState(root).tasks.filter(task => task.key === 'role:https://jobs.example.test/1').length, 1);
  assert.equal(readState(root).tasks.find(task => task.key.startsWith('role:')).state, 'review_ready');
  assert.equal(readState(root).reviews.filter(review => review.type === 'job_packet').length, 1);

  await workerOnce(root, { services: impl, now: new Date(now.getTime() + 60_000) });
  assert.equal(calls.role, 1, 'review-ready tasks and repeated discoveries must not be re-evaluated');
  assert.equal(readState(root).tasks.filter(task => task.key.startsWith('role:')).length, 1);
  assert.equal(readState(root).reviews.filter(review => review.type === 'job_packet').length, 1);
});

test('preflight block releases a reserved role slot before any model call', async t => {
  const root = fixture(t); await writeConfig(root, { ...config });
  const now = new Date();
  const calls = {};
  const impl = services({
    discovered: [{ key: 'role:preflight', cohort: 'new', payload: { url: 'https://jobs.example.test/preflight' } }],
    roleOutcome: { state: 'blocked', aiStarted: false, reason: 'source changed', requiredAction: 'review' }, calls,
  });
  await workerOnce(root, { services: impl, now });
  const state = readState(root);
  assert.equal(calls.role, 1, 'fake execution seam ran; no real model launcher is installed in the test');
  const day = localDay(now, config.timezone);
  assert.deepEqual(state.budgets[day].roles, {});
  assert.deepEqual(state.budgets[day].cohorts.new, {});
  assert.equal(state.tasks[0].state, 'blocked');
});

test('worker recovers an expired claim after restart and respects its task idempotency key', async t => {
  const root = fixture(t); await writeConfig(root, { ...config });
  const now = new Date(); const oldAt = new Date(now.getTime() - 2_000);
  await enqueueTask(root, { key: 'draft:restart', type: 'mail_draft', payload: { kind: 'followup' }, now: oldAt });
  const old = await claimTask(root, { types: ['mail_draft'], owner: 'crashed-worker', now: oldAt, leaseMs: 1_000 });
  assert.ok(old);
  const calls = {};
  const impl = services({ calls });
  await workerOnce(root, { services: impl, now });
  const recovered = readState(root).tasks.find(task => task.key === 'draft:restart');
  assert.equal(calls.draft, 1);
  assert.equal(recovered.attempts, 2);
  assert.equal(recovered.state, 'review_ready');
  await workerOnce(root, { services: impl, now: new Date(now.getTime() + 60_000) });
  assert.equal(calls.draft, 1, 'a second worker process/tick does not repeat a completed draft');
});

test('worker never invokes real mail or model execution when service adapters are injected', async t => {
  const root = fixture(t); await writeConfig(root, { ...config });
  const now = new Date();
  let transportCalls = 0, modelCalls = 0;
  const impl = services({
    discovered: [{ key: 'role:no-real-ai', cohort: 'new', payload: { url: 'https://jobs.example.test/2' } }],
    calls: { get role() { return modelCalls; }, set role(value) { modelCalls = value; }, get poll() { return transportCalls; }, set poll(value) { transportCalls = value; } },
  });
  await workerOnce(root, { services: impl, now });
  assert.equal(modelCalls, 1, 'only the injected role executor ran');
  assert.equal(transportCalls, 1, 'only the injected mail poll ran');
  assert.equal(fs.existsSync(path.join(root, 'data/mail/outbox')), false);
  assert.equal(fs.existsSync(path.join(root, 'data/mail/cursors')), false);
});

test('missing Codex authentication blocks before claiming a task or reserving its role budget', async t => {
  const root = fixture(t); await writeConfig(root, { ...config });
  const now = new Date(); const calls = {};
  const impl = services({ discovered: [{ key: 'role:no-auth', cohort: 'new', payload: { url: 'https://jobs.example.test/no-auth' } }], calls });
  impl.checkCodexLogin = async () => ({ ok: false, reason: 'Codex login is required' });
  await workerOnce(root, { services: impl, now });
  const state = readState(root);
  assert.equal(calls.role, undefined);
  assert.equal(state.tasks[0].state, 'queued');
  assert.deepEqual(state.budgets[localDay(now, config.timezone)]?.roles ?? {}, {});
  assert.ok(state.reviews.some(item => item.key === 'setup:codex'));
  assert.equal(state.worker.authentication.ok, false);
});

test('paused worker does not discover, sync mail, scan, or draft', async t => {
  const root = fixture(t); await writeConfig(root, { ...config, paused: true });
  const calls = {};
  const result = await workerOnce(root, { services: services({ calls }) });
  assert.equal(result.status, 'paused');
  assert.deepEqual(calls, {});
  assert.equal(readState(root).tasks.length, 0);
});

test('daily role cap prevents execution, then an unreserved task can run after the local-day budget resets', async t => {
  const root = fixture(t); await writeConfig(root, { ...config, dailyRoles: 0 });
  const now = new Date(); const calls = {};
  const impl = services({ discovered: [{ key: 'role:next-day', cohort: 'new', payload: { url: 'https://jobs.example.test/next' } }], calls });
  await workerOnce(root, { services: impl, now });
  assert.equal(calls.role, undefined);
  assert.equal(readState(root).tasks[0].state, 'queued');

  await writeConfig(root, { dailyRoles: 1 });
  const nextDay = new Date(now.getTime() + 86_400_000);
  await workerOnce(root, { services: impl, now: nextDay });
  assert.equal(calls.role, 1);
  assert.equal(readState(root).tasks[0].state, 'review_ready');
  assert.equal(Object.keys(readState(root).budgets[localDay(nextDay, config.timezone)].roles).length, 1);
});

test('scanner receipts deduplicate an active source recovery chain and resolve it on a complete receipt', async t => {
  const root = fixture(t); await writeConfig(root, { ...config });
  const now = new Date('2026-10-23T16:00:00.000Z');
  const sourceId = 'portals:example.test';
  const configSha256 = 'config-sha-1';
  const services = {
    recoveryTasks(receipt) {
      return receipt.targets.filter(target => !target.complete).map(target => ({
        key: `recovery:${receipt.startedAt}:${target.sourceId}`,
        type: 'source_recovery',
        payload: { sourceId: target.sourceId, configSha256: receipt.configSha256 },
      }));
    },
  };
  const failedReceipt = startedAt => ({ startedAt, configSha256, targets: [{ sourceId, status: 'error', complete: false }] });

  await ingestReceipt(root, failedReceipt('2026-10-23T15:00:00.000Z'), { services, now });
  const first = readState(root).tasks.find(task => task.type === 'source_recovery');
  assert.ok(first);
  const review = await addReview(root, { key: 'repair:example', type: 'source_repair', title: 'Repair source', taskId: first.id, now });
  await ingestReceipt(root, failedReceipt('2026-10-23T15:30:00.000Z'), { services, now });

  let state = readState(root);
  assert.equal(state.tasks.filter(task => task.type === 'source_recovery').length, 1, 'different scanner run keys share one active source/config chain');
  assert.deepEqual(state.tasks[0].sourceOccurrences, ['2026-10-23T15:00:00.000Z', '2026-10-23T15:30:00.000Z']);

  await ingestReceipt(root, { startedAt: '2026-10-23T16:00:00.000Z', configSha256, targets: [{ sourceId, status: 'success', complete: true }] }, { services, now });
  state = readState(root);
  assert.equal(state.tasks[0].state, 'completed');
  assert.equal(state.tasks[0].result.resolvedByReceipt, '2026-10-23T16:00:00.000Z');
  assert.equal(state.reviews.find(item => item.id === review.review.id).state, 'resolved');
  assert.equal(state.reviews.find(item => item.id === review.review.id).revision, 2);

  await ingestReceipt(root, failedReceipt('2026-10-23T16:30:00.000Z'), { services, now });
  state = readState(root);
  assert.equal(state.tasks.filter(task => task.type === 'source_recovery').length, 2, 'a new failure after resolution starts a fresh chain');
  assert.notEqual(state.tasks[1].id, first.id);
  assert.equal(state.tasks[1].payload.sourceId, sourceId);
  assert.equal(state.tasks[1].payload.configSha256, configSha256);
});

test('source recovery waits behind the same scheduled-runner lock used by manual scans', async t => {
  const root = fixture(t); await writeConfig(root, { ...config });
  const now = new Date(); const calls = { recovery: 0, scheduled: 0 };
  const task = (await enqueueTask(root, { key: 'recovery:locked', type: 'source_recovery', payload: { sourceId: 'locked-source' }, now })).task;
  const impl = services({ calls });
  impl.executeRecovery = async () => { calls.recovery++; return { state: 'completed' }; };
  impl.runScheduledTick = async () => { calls.scheduled++; return { status: 'idle' }; };
  await withResourceLock(scheduledRunnerResourcePath(scheduledStorePath(root)), async () => {
    await assert.rejects(runScanTick(root, { services: impl, now }), /lock|busy|timeout/i);
    assert.equal(calls.recovery, 0, 'recovery does not start while a manual scan owns the runner lock');
    assert.equal(calls.scheduled, 0, 'a second scheduled scan does not start while the lock is held');
    assert.equal(readState(root).tasks.find(item => item.id === task.id).state, 'queued', 'the recovery task remains unclaimed');
  }, { timeoutMs: 100 });
});

test('missing and malformed scheduled scan receipts become source repair reviews', async t => {
  const root = fixture(t); await writeConfig(root, { ...config });
  const malformedPath = path.join(root, 'data/automation/bad-receipt.json');
  fs.mkdirSync(path.dirname(malformedPath), { recursive: true });
  fs.writeFileSync(malformedPath, '{not-json');
  const missingPath = path.join(root, 'data/automation/missing-receipt.json');
  const impl = services();
  impl.runScheduledTick = async (_root, { onReceipt }) => {
    await onReceipt(missingPath, { state: 'failed' }, { id: 'missing-job', name: 'Missing receipt scan' });
    await onReceipt(malformedPath, { state: 'failed' }, { id: 'malformed-job', name: 'Malformed receipt scan' });
    return { status: 'finished' };
  };

  const result = await runScanTick(root, { services: impl, now: new Date() });
  assert.equal(result.status, 'finished');
  const reviews = readState(root).reviews.filter(item => item.type === 'source_repair');
  assert.equal(reviews.length, 2);
  assert.ok(reviews.some(item => item.payload.jobId === 'missing-job' && /stopped before writing/.test(item.payload.reason)));
  assert.ok(reviews.some(item => item.payload.jobId === 'malformed-job' && /could not be read or validated/.test(item.payload.reason)));
});

test('role retry limits count failures per AI stage and keep one role reservation', async t => {
  const root = fixture(t); await writeConfig(root, { ...config, dailyRoles: 1 });
  const start = new Date(Date.now() - 1_000);
  const unreserved = (await enqueueTask(root, { key: 'role:unreserved-first', type: 'role_packet', cohort: 'new', payload: { url: 'https://jobs.example.test/unreserved-first' }, now: start })).task;
  const task = (await enqueueTask(root, { key: 'role:stage-retries', type: 'role_packet', cohort: 'new', payload: { url: 'https://jobs.example.test/stage-retries' }, now: start })).task;
  await reserveBudget(root, { kind: 'role', key: task.key, cohort: 'new', now: start });
  const impl = services();
  const attempts = ['evaluation', 'evaluation', 'documents', 'documents', 'documents'];
  impl.executeRole = async () => {
    const stage = attempts.shift();
    return { state: 'failed', aiStarted: true, reason: `${stage} failed`, checkpoint: { stage } };
  };

  const expectations = [
    ['retry_waiting', { evaluation: 1 }],
    ['retry_waiting', { evaluation: 2 }],
    ['retry_waiting', { evaluation: 2, documents: 1 }],
    ['retry_waiting', { evaluation: 2, documents: 2 }],
    ['failed', { evaluation: 2, documents: 3 }],
  ];
  for (const [index, [expectedState, expectedFailures]] of expectations.entries()) {
    const now = new Date(start.getTime() + index * 60_000);
    await runAiTick(root, { services: impl, config: { ...config, dailyRoles: 1 }, now, owner: `test-worker-${index}` });
    const state = readState(root);
    const current = state.tasks.find(item => item.id === task.id);
    assert.equal(current.state, expectedState, `failure ${index + 1} has the expected retry state`);
    assert.deepEqual(current.stageFailures, expectedFailures);
    assert.equal(Object.keys(state.budgets[localDay(now, config.timezone)].roles).length, 1, 'all stages and retries share the role reservation');
    assert.equal(state.tasks.find(item => item.id === unreserved.id).state, 'queued', 'the reserved retry is claimed before earlier unreserved work at a full cap');
  }
  assert.deepEqual(readState(root).tasks.find(item => item.id === task.id).stageFailures, { evaluation: 2, documents: 3 });
});

test('stale role reservation from a crash before launch is returned when retry preflight blocks', async t => {
  const root = fixture(t); await writeConfig(root, { ...config, dailyRoles: 1 });
  const oldAt = new Date(Date.now() - 120_000), now = new Date();
  const task = (await enqueueTask(root, { key: 'role:crash-before-launch', type: 'role_packet', cohort: 'new', payload: { url: 'https://jobs.example.test/crash-before-launch' }, now: oldAt })).task;
  const reservation = await reserveBudget(root, { kind: 'role', key: task.key, cohort: 'new', now: oldAt });
  await claimTask(root, { types: ['role_packet'], owner: 'crashed-role-worker', now: oldAt, leaseMs: 1_000 });
  const impl = services();
  impl.pipelinePreflight = async () => ({ ok: false, reason: 'profile changed before AI launch' });

  await runAiTick(root, { services: impl, config: { ...config, dailyRoles: 1 }, now, owner: 'restarted-role-worker' });
  const state = readState(root);
  assert.equal(state.tasks.find(item => item.id === task.id).state, 'blocked');
  assert.equal(Object.keys(state.budgets[reservation.day].roles).length, 0, 'the unstarted same-day allocation is released despite created:false on recovery');
  assert.equal(Object.keys(state.budgets[reservation.day].cohorts.new).length, 0);
});

test('stale draft reservation before launch is returned on preflight block while started retries keep the allocation', async t => {
  const root = fixture(t); await writeConfig(root, { ...config, dailyDrafts: 1 });
  const oldAt = new Date(Date.now() - 120_000), now = new Date();
  const task = (await enqueueTask(root, { key: 'draft:crash-before-launch', type: 'mail_draft', payload: { kind: 'followup' }, now: oldAt })).task;
  const reservation = await reserveBudget(root, { kind: 'draft', key: task.key, now: oldAt });
  await claimTask(root, { types: ['mail_draft'], owner: 'crashed-draft-worker', now: oldAt, leaseMs: 1_000 });
  const impl = services({ mailOutcome: { state: 'blocked', aiStarted: false, reason: 'mail preflight blocked' } });

  await runAiTick(root, { services: impl, config: { ...config, dailyDrafts: 1 }, now, owner: 'restarted-draft-worker' });
  let state = readState(root);
  assert.equal(state.tasks.find(item => item.id === task.id).state, 'blocked');
  assert.equal(Object.keys(state.budgets[reservation.day].drafts).length, 0, 'a pre-launch block returns the daily draft slot');

  const retryRoot = fixture(t); await writeConfig(retryRoot, { ...config, dailyDrafts: 1 });
  const retryTask = (await enqueueTask(retryRoot, { key: 'draft:started-retry', type: 'mail_draft', payload: { kind: 'followup' }, now: oldAt })).task;
  const startedReservation = await reserveBudget(retryRoot, { kind: 'draft', key: retryTask.key, now: oldAt });
  await claimTask(retryRoot, { types: ['mail_draft'], owner: 'crashed-after-launch', now: oldAt, leaseMs: 1_000 });
  const retryImpl = services();
  retryImpl.executeMailDraft = async (_root, _task, { beforeAiStart }) => {
    await beforeAiStart();
    throw new Error('worker process failed after model launch');
  };
  await runAiTick(retryRoot, { services: retryImpl, config: { ...config, dailyDrafts: 1 }, now, owner: 'retry-after-launch' });
  state = readState(retryRoot);
  assert.equal(state.budgets[startedReservation.day].drafts[retryTask.key].startedAt, now.toISOString());
  assert.equal(Object.keys(state.budgets[startedReservation.day].drafts).length, 1, 'a launched draft retry keeps the already-consumed allocation');
  assert.equal(state.tasks.find(item => item.id === retryTask.id).state, 'retry_waiting');
});
