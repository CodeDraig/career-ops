#!/usr/bin/env node
// Disposable acceptance probe for the automation pieces that can run without
// real candidate data, credentials, mailboxes, job boards, or model access.
// Intended for: node container/test-automation-acceptance.mjs
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { runScheduledTick } from '../web/scripts/scheduled-jobs-runner.mjs';
import { checkCodexLogin, runAutomationCodex } from '../lib/automation/execution.mjs';
import { workerOnce } from '../lib/automation/worker.mjs';
import { readState, writeConfig } from '../lib/automation/store.mjs';
import { executeRole as executeRolePipeline } from '../lib/automation/pipeline.mjs';

const codeRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'career-ops-automation-acceptance-data-'));
const home = fs.mkdtempSync(path.join(os.tmpdir(), 'career-ops-automation-acceptance-home-'));
const codexHome = path.join(home, '.codex');
const workers = new Set();

function write(relative, text, mode = 0o600) {
  const filename = path.join(root, relative);
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filename, text, { mode });
  return filename;
}

function spawnChild(command, args, options = {}) {
  const child = spawn(command, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
  workers.add(child);
  child.once('close', () => workers.delete(child));
  return child;
}

async function waitFor(predicate, label, timeoutMs = 8_000) {
  const stopAt = Date.now() + timeoutMs;
  while (Date.now() < stopAt) {
    if (predicate()) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function stop(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill('SIGTERM');
  await Promise.race([new Promise(resolve => child.once('close', resolve)), delay(5_000)]);
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
}

try {
  fs.mkdirSync(codexHome, { recursive: true, mode: 0o700 });
  // A fake, instance-local Codex login marker. No real credentials are read.
  fs.writeFileSync(path.join(codexHome, 'auth.json'), JSON.stringify({ fixture: true }), { mode: 0o600 });
  const env = { ...process.env, HOME: home, CODEX_HOME: codexHome, CAREER_OPS_ROOT: root, PATH: `${path.dirname(process.execPath)}:${process.env.PATH || ''}` };
  const fakeCodex = write('fixtures/codex', `#!/usr/bin/env node\nconst fs=require('node:fs');\nif(process.argv[2]==='login'&&process.argv[3]==='status'){const ok=fs.existsSync(process.env.CODEX_HOME+'/auth.json'); console.log(ok?'Logged in (fixture)':'Not logged in'); process.exit(ok?0:1)}\nif(process.argv[2]==='exec'){console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'fixture Codex result'}})); process.exit(0)}\nprocess.exit(2);\n`, 0o700);
  fs.chmodSync(fakeCodex, 0o700);
  const resolveFake = () => ({ binPath: fakeCodex, spec: { id: 'codex' } });
  const auth = await checkCodexLogin({ resolveCliFn: resolveFake, env });
  assert.deepEqual(auth, { ok: true }, 'login readiness uses this isolated HOME/CODEX_HOME');
  const codexResult = await runAutomationCodex(root, 'Acceptance fixture prompt', {
    env, resolveCliFn: resolveFake, spawnFn: (bin, args, options) => spawnChild(bin, args, options),
    config: { timeoutMs: 5_000 },
  });
  assert.equal(codexResult.exitCode, 0);
  assert.equal(codexResult.text.trim(), 'fixture Codex result');

  for (const [relative, body] of Object.entries({
    'cv.md': '# CV\n', 'config/profile.yml': 'candidate:\n  full_name: Fixture Candidate\ncv:\n  output_format: text\n',
    'modes/_profile.md': 'Fixture targeting.\n', 'portals.yml': 'title_filter:\n  positive: [engineer]\nlocation_filter: {}\n',
  })) write(relative, body);
  const enabled = { enabled: true, paused: false, timezone: 'America/New_York', dailyRoles: 20, dailyDrafts: 20, newSlots: 10, backlogSlots: 10, mailAccounts: [], model: '', effort: '' };
  await writeConfig(root, enabled);

  // The scheduled runner claims one due saved scan and launches this local
  // child fixture instead of scan.mjs. It emits a detailed receipt and makes
  // no network request.
  const scanFixture = write('fixtures/scanner.mjs', `import fs from 'node:fs';\nconst args=process.argv.slice(2); const i=args.indexOf('--run-receipt');\nif(i<0)process.exit(4); const file=args[i+1];\nfs.writeFileSync(file,JSON.stringify({schema:'career-ops.scan-run@1',runId:'fixture-run',scanner:'ats-full',startedAt:new Date().toISOString(),finishedAt:new Date().toISOString(),configSha256:'fixture',baseConfigSha256:'fixture',scope:{runArgs:args.filter((x,n)=>x!=='--run-receipt'&&n!==i+1),effectiveConfigPath:process.env.CAREER_OPS_EFFECTIVE_PORTALS_SNAPSHOT},targets:[{sourceId:'fixture-board',name:'Fixture Board',provider:'fixture',configScope:'fixture',status:'success',complete:true,jobs:1,addedUrls:1,warnings:[],error:null,kind:null,statusCode:null,retryAfter:null}]}));\nconsole.log(JSON.stringify({postingsKept:1}));\n`);
  const schedulePath = path.join(root, 'data', 'scheduled-jobs.json');
  fs.mkdirSync(path.dirname(schedulePath), { recursive: true, mode: 0o700 });
  const now = new Date().toISOString();
  fs.writeFileSync(schedulePath, JSON.stringify({ jobs: [{ id: '11111111-1111-4111-8111-111111111111', name: 'Fixture scan', status: 'active', engine: 'full', filters: { positive: ['engineer'] }, timezone: 'UTC', startAt: now, every: 1, unit: 'hours', createdAt: now, updatedAt: now }], runs: [], queue: [] }));
  let receivedReceipt;
  const scan = await runScheduledTick(root, {
    storePath: schedulePath,
    spawnFn: (command, args, options) => new Promise(resolve => {
      const child = spawnChild(process.execPath, [scanFixture, ...args.slice(1)], { ...options, cwd: root });
      let stdout = '', stderr = '';
      child.stdout.on('data', chunk => stdout += chunk);
      child.stderr.on('data', chunk => stderr += chunk);
      child.once('close', status => resolve({ status, stdout, stderr }));
    }),
    onReceipt: async filename => { receivedReceipt = filename; },
  });
  assert.equal(scan.status, 'success');
  assert.equal(scan.rolesFound, 1);
  assert.ok(receivedReceipt && fs.existsSync(receivedReceipt));
  const receipt = JSON.parse(fs.readFileSync(receivedReceipt, 'utf8'));
  assert.equal(receipt.targets[0].sourceId, 'fixture-board');
  assert.ok(fs.existsSync(receipt.scope.effectiveConfigPath), 'effective config snapshot survives overlay cleanup');

  // Exercise durable role/draft budgets and review records via worker's
  // explicit adapters. Both AI calls go through runAutomationCodex above's
  // fake executable; mail polling is a fixture adapter and never sends SMTP.
  const calls = [];
  const services = {
    discoverPipeline: async () => [
      { key: 'role-packet:fixture', cohort: 'new', payload: { url: 'https://example.invalid/jobs/fixture', company: 'Fixture Co', role: 'Support Engineer' } },
    ],
    pipelinePreflight: async () => ({ ok: true, inputFingerprint: 'fixture-input' }),
    executeRole: async (_root, task, options) => {
      let invocation = 0;
      const run = async (runRoot, prompt, runOptions) => {
        const result = await runAutomationCodex(runRoot, prompt, { env, resolveCliFn: resolveFake, spawnFn: (bin, args, opts) => spawnChild(bin, args, opts), config: runOptions.config });
        if (invocation++ === 0) {
          const date = new Date().toISOString().slice(0, 10);
          write(`reports/001-fixture-${date}.md`, `# Fixture Co — Support Engineer\n\n**URL:** ${task.payload.url}\n\nscore: 2\n\n## Job Description (archived verbatim)\n\nFixture posting.\n\n## Machine Summary\n\nscore: 2\n`);
          write('data/applications.md', `| 1 | ${date} | Fixture Co | Generalist | 2/5 | New | — | — | [posting](${task.payload.url}) |\n`);
        }
        return result;
      };
      calls.push('role');
      return executeRolePipeline(root, task, { ...options, run });
    },
    runScheduledTick: async () => ({ status: 'idle' }),
    pollMail: async () => ({ tasks: [{ key: 'mail-draft:fixture', type: 'mail_draft', payload: { kind: 'reply', fixtureMessage: true } }], reviews: [{ key: 'mail-review:fixture', type: 'mail_digest', title: 'Fixture incoming message' }] }),
    executeMailDraft: async () => {
      const result = await runAutomationCodex(root, 'Draft fixture reply from supplied facts', { env, resolveCliFn: resolveFake, spawnFn: (bin, args, opts) => spawnChild(bin, args, opts), config: {} });
      calls.push('draft'); assert.equal(result.exitCode, 0);
      return { state: 'review_ready', aiStarted: true, result: { draft: 'fixture draft for review' } };
    },
    executeRecovery: async () => ({ state: 'completed' }), recoveryTasks: () => [],
    checkCodexLogin: async () => auth,
  };
  const tick = await workerOnce(root, { services });
  assert.equal(tick.status, 'finished');
  // Mail polling and the AI lane are intentionally parallel; the draft task
  // can become visible on the following tick after the poll commits it.
  await workerOnce(root, { services });
  assert.deepEqual(calls.sort(), ['draft', 'role']);
  const firstState = readState(root);
  assert.equal(firstState.tasks.filter(task => task.state === 'review_ready').length, 2, JSON.stringify(firstState.tasks.map(({ type, state, result, lastReason }) => ({ type, state, result, lastReason }))));
  const roleTask = firstState.tasks.find(task => task.type === 'role_packet');
  assert.equal(roleTask.result.score, 2, 'real role executor verified the fixture report and canonical tracker receipt');
  assert.ok(fs.readdirSync(path.join(root, 'reports')).some(name => name.startsWith(`${roleTask.result.reportNum}-`)));
  assert.match(fs.readFileSync(path.join(root, 'data', 'applications.md'), 'utf8'), /example\.invalid\/jobs\/fixture/);
  assert.equal(firstState.reviews.some(review => review.type === 'job_packet'), true);
  assert.equal(firstState.reviews.some(review => review.type === 'mail_draft'), true);
  const budgetDay = Object.keys(firstState.budgets)[0];
  assert.equal(Object.keys(firstState.budgets[budgetDay].roles).length, 1);
  assert.equal(Object.keys(firstState.budgets[budgetDay].drafts).length, 1);
  assert.equal(fs.existsSync(path.join(root, 'data', 'mail', 'outbox')), false, 'fixture mail workflow creates no SMTP outbox');

  // Run the real daemon in paused mode. Heartbeat should be live, shutdown
  // should exit cleanly, and a second process should reuse the same durable
  // state while publishing its own heartbeat.
  await writeConfig(root, { paused: true });
  const workerEnv = { ...env, CAREER_OPS_ROOT: root, CAREER_OPS_CODE_ROOT: codeRoot };
  const startWorker = () => {
    const child = spawnChild(process.execPath, [path.join(codeRoot, 'automation.mjs'), 'worker'], { cwd: root, env: workerEnv });
    child.stderr.on('data', () => {});
    return child;
  };
  const heartbeatPath = path.join(root, 'data', 'automation', 'worker-heartbeat.json');
  const firstDaemon = startWorker();
  await waitFor(() => { try { const data = JSON.parse(fs.readFileSync(heartbeatPath, 'utf8')); return data.pid === firstDaemon.pid && data.enabled && data.paused; } catch { return false; } }, 'first worker heartbeat');
  const firstPid = JSON.parse(fs.readFileSync(heartbeatPath, 'utf8')).pid;
  await stop(firstDaemon);
  const secondDaemon = startWorker();
  await waitFor(() => { try { const data = JSON.parse(fs.readFileSync(heartbeatPath, 'utf8')); return data.pid === secondDaemon.pid && data.enabled && data.paused; } catch { return false; } }, 'restarted worker heartbeat');
  assert.notEqual(secondDaemon.pid, firstPid, 'restart starts a distinct worker process');
  const restartedState = readState(root);
  assert.equal(restartedState.reviews.length, firstState.reviews.length, 'reviews survive worker restart');
  assert.deepEqual(restartedState.budgets, firstState.budgets, 'daily budget reservations survive worker restart');
  assert.deepEqual(restartedState.tasks.map(task => [task.key, task.state, task.attempts]), firstState.tasks.map(task => [task.key, task.state, task.attempts]), 'task identities, states and attempts survive worker restart');
  assert.equal(JSON.parse(fs.readFileSync(heartbeatPath, 'utf8')).paused, true, 'paused worker remains visibly alive but claims no work');
  await stop(secondDaemon);

  process.stdout.write(JSON.stringify({ status: 'passed', isolatedRoot: root, isolatedHome: home, checks: [
    'fake Codex login status and JSONL result in isolated HOME',
    'saved scan claimed once and run by local scanner fixture with persistent receipt snapshot',
    'role packet and mail draft tasks persisted with daily budget reservations and review items',
    'no SMTP outbox or external mail send',
    'real worker daemon heartbeat, paused behavior, graceful shutdown and restart persistence',
  ] }, null, 2) + '\n');
} catch (error) {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
} finally {
  await Promise.all([...workers].map(stop));
  fs.rmSync(root, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
}
