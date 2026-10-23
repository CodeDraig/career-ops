import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { automationStatus, configureAutomation, reviewAction, retryTask } from '../lib/automation/service.mjs';
import { addReview, enqueueTask, readConfig, readState, withState, writeConfig } from '../lib/automation/store.mjs';
import { pipelinePreflight } from '../web/src/lib/automation/pipeline.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-automation-service-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('status on a fresh data root returns defaults and does not initialize files', async t => {
  const root = fixture(t);
  const status = await automationStatus(root, { now: '2026-10-23T12:00:00Z' });
  assert.equal(status.config.enabled, false);
  assert.equal(status.config.paused, false);
  assert.equal(status.config.dailyRoles, 20);
  assert.equal(status.config.dailyDrafts, 20);
  assert.equal(status.worker.healthy, false);
  assert.ok(status.blockers.some(item => item.code === 'profile_setup'));
  assert.equal(fs.existsSync(path.join(root, 'config')), false);
  assert.equal(fs.existsSync(path.join(root, 'data')), false);
});

test('first activation snapshots current pipeline URLs as backlog exactly once', async t => {
  const root = fixture(t);
  await writeConfig(root, { dailyDrafts: 7 });
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  fs.writeFileSync(path.join(root, 'data/pipeline.md'), [
    '# Pipeline', '', '## Pending',
    '- [ ] https://jobs.example.test/old-role',
    '- [ ] https://jobs.example.test/second-role',
    '', '## Processed', '- [x] https://jobs.example.test/closed', '',
  ].join('\n'));

  let activating = true;
  const samples = [];
  const activation = configureAutomation(root, { enabled: true }).finally(() => { activating = false; });
  while (activating) {
    const currentConfig = readConfig(root), currentState = readState(root);
    samples.push({ enabled: currentConfig.enabled, hasActivation: Boolean(currentState.activation) });
    await new Promise(resolve => setImmediate(resolve));
  }
  await activation;
  const first = readState(root).activation;
  assert.ok(samples.length > 0, 'observed settings during first-enable initialization');
  assert.ok(samples.every(sample => !sample.enabled || sample.hasActivation), 'an enabled setting is never visible before the backlog snapshot is committed');
  assert.equal(readConfig(root).enabled, true);
  assert.equal(readConfig(root).dailyDrafts, 7, 'activation preserves existing settings');
  assert.deepEqual(new Set(first.backlogUrls), new Set([
    'https://jobs.example.test/old-role',
    'https://jobs.example.test/second-role',
  ]));
  await configureAutomation(root, { paused: true });
  assert.deepEqual(readState(root).activation, first, 'later settings changes must not move the cohort boundary');
});

test('review API rejects send, submit, portal rewrite, and arbitrary actions without resolving the item', async t => {
  const root = fixture(t);
  const created = await addReview(root, { key: 'review:1', type: 'job_packet', title: 'Review packet' });
  for (const action of ['send', 'submit', 'rewrite_portals', 'run_free_text']) {
    await assert.rejects(reviewAction(root, created.review.id, { expectedRevision: 1, action }), error => error.status === 400);
  }
  const [current] = readState(root).reviews;
  assert.equal(current.state, 'open');
  assert.equal(current.revision, 1);
});

test('review API uses revision guards and permits a simple reviewed action', async t => {
  const root = fixture(t);
  const created = await addReview(root, { key: 'review:2', type: 'source_repair', title: 'Inspect source' });
  const result = await reviewAction(root, created.review.id, { expectedRevision: 1, action: 'reviewed' });
  assert.equal(result.review.state, 'resolved');
  assert.equal(result.review.revision, 2);
  await assert.rejects(reviewAction(root, created.review.id, { expectedRevision: 1, action: 'dismiss' }), error => error.status === 409);
});

test('retry after profile facts change creates a new role revision and preserves prior report artifacts', async t => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, 'config'), { recursive: true });
  fs.mkdirSync(path.join(root, 'modes'), { recursive: true });
  fs.mkdirSync(path.join(root, 'data'), { recursive: true });
  fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(root, 'cv.md'), '# Candidate\n\n## Experience\n- Support role\n');
  fs.writeFileSync(path.join(root, 'config/profile.yml'), 'name: Test Candidate\n');
  fs.writeFileSync(path.join(root, 'modes/_profile.md'), 'Target support engineering roles.\n');
  fs.writeFileSync(path.join(root, 'portals.yml'), 'companies: []\n');
  const url = 'https://jobs.example.test/role-1';
  fs.writeFileSync(path.join(root, 'data/pipeline.md'), `# Pipeline\n\n## Pending\n- [ ] ${url}\n\n## Processed\n`);
  const oldReport = path.join(root, 'reports/001-example-2026-10-23.md');
  const reportBody = `**URL:** ${url}\n\nprior report contents\n`;
  fs.writeFileSync(oldReport, reportBody);
  const task = (await enqueueTask(root, { key: url, type: 'role_packet', cohort: 'backlog', payload: { url } })).task;
  const originalFingerprint = pipelinePreflight(root, task).inputFingerprint;
  await withState(root, state => {
    const current = state.tasks.find(item => item.id === task.id);
    current.inputFingerprint = originalFingerprint;
    current.state = 'failed';
    current.result = { reportPath: 'reports/001-example-2026-10-23.md' };
  });
  fs.writeFileSync(path.join(root, 'cv.md'), '# Candidate\n\n## Experience\n- Newly corrected support role\n');

  const revised = await retryTask(root, task.id);
  const state = readState(root);
  const old = state.tasks.find(item => item.id === task.id);
  assert.notEqual(revised.id, task.id);
  assert.notEqual(revised.inputFingerprint, originalFingerprint);
  assert.equal(revised.payload.forceReevaluation, true);
  assert.equal(revised.payload.previousTaskId, task.id);
  assert.equal(old.state, 'cancelled');
  assert.equal(old.supersededBy, revised.id);
  assert.equal(old.result.reportPath, 'reports/001-example-2026-10-23.md');
  assert.equal(fs.readFileSync(oldReport, 'utf8'), reportBody, 'the old report is retained unchanged');
});

test('retry rejects running, completed, and review-ready tasks before profile-change revision logic', async t => {
  for (const stateName of ['running', 'completed', 'review_ready']) {
    const root = fixture(t);
    fs.mkdirSync(path.join(root, 'config'), { recursive: true });
    fs.mkdirSync(path.join(root, 'modes'), { recursive: true });
    fs.mkdirSync(path.join(root, 'data'), { recursive: true });
    fs.writeFileSync(path.join(root, 'cv.md'), '# Candidate\n\n## Experience\n- Support role\n');
    fs.writeFileSync(path.join(root, 'config/profile.yml'), 'name: Test Candidate\n');
    fs.writeFileSync(path.join(root, 'modes/_profile.md'), 'Target support engineering roles.\n');
    fs.writeFileSync(path.join(root, 'portals.yml'), 'companies: []\n');
    const url = 'https://jobs.example.test/role-guard';
    fs.writeFileSync(path.join(root, 'data/pipeline.md'), `# Pipeline\n\n## Pending\n- [ ] ${url}\n\n## Processed\n`);
    const task = (await enqueueTask(root, { key: url, type: 'role_packet', cohort: 'backlog', payload: { url } })).task;
    const fingerprint = pipelinePreflight(root, task).inputFingerprint;
    await withState(root, current => {
      const stored = current.tasks.find(item => item.id === task.id);
      stored.inputFingerprint = fingerprint;
      stored.state = stateName;
    });
    fs.writeFileSync(path.join(root, 'cv.md'), '# Candidate\n\n## Experience\n- Corrected support engineering role\n');

    await assert.rejects(retryTask(root, task.id), error => error.status === 409);
    const after = readState(root);
    assert.equal(after.tasks.length, 1, `${stateName}: no revision task is created`);
    assert.equal(after.tasks[0].state, stateName, `${stateName}: existing state remains unchanged`);
  }
});
