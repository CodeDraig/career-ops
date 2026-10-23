import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import * as yaml from 'js-yaml';
import { withResourceLock } from '../../web/src/lib/scheduled-jobs-store.mjs';
import { scheduledRunnerResourcePath, scheduledStorePath } from '../../web/src/lib/scheduled-runner-path.mjs';
import { writeFileAtomic } from '../../tracker-utils.mjs';
import { readConfig, readState, withState, enqueueTask, claimTask, heartbeatTask, finishTask, addReview, reserveBudget, releaseBudget, markBudgetStarted, chooseRoleCohort, writeAttempt } from './store.mjs';
import { localDay, setupBlockers, createDailyDigest } from './service.mjs';

const TYPES = new Set(['role_packet', 'mail_draft', 'source_recovery']);
const due = (task, now) => task.state === 'queued' || task.state === 'retry_waiting' && Date.parse(task.availableAt) <= now.getTime() || task.state === 'running' && task.lease && Date.parse(task.lease.expiresAt) <= now.getTime();

async function implementations(overrides = {}) {
  const [pipeline, mail, recovery, scheduled, execution] = await Promise.all([
    import('./pipeline.mjs'), import('./mail.mjs'), import('./recovery.mjs'), import('../../web/scripts/scheduled-jobs-runner.mjs'), import('./execution.mjs'),
  ]);
  return { ...pipeline, ...mail, ...recovery, ...scheduled, checkCodexLogin: execution.checkCodexLogin, ...overrides };
}

export async function ingestReceipt(root, receipt, { services, now = new Date() } = {}) {
  const impl = services || await implementations();
  if (!receipt || !Array.isArray(receipt.targets)) throw new Error('Scanner did not provide a detailed target receipt');
  await withState(root, state => {
    for (const target of receipt.targets.filter(target => target.complete && !['error', 'incomplete'].includes(target.status))) {
      for (const task of state.tasks.filter(task => task.type === 'source_recovery' && task.payload.sourceId === target.sourceId && task.payload.configSha256 === receipt.configSha256 && !['completed', 'cancelled'].includes(task.state))) {
        task.state = 'completed'; task.lease = null; task.updatedAt = now.toISOString();
        task.result = { resolvedByReceipt: receipt.startedAt, sourceId: target.sourceId, complete: true };
        for (const review of state.reviews.filter(review => review.taskId === task.id && review.state === 'open')) {
          review.state = 'resolved'; review.revision++; review.updatedAt = now.toISOString(); review.resolution = { action: 'source_recovered', receipt: receipt.startedAt };
        }
      }
    }
  });
  for (const input of impl.recoveryTasks(receipt, { now })) {
    if (!TYPES.has(input.type)) throw new Error('Unknown automation task type');
    const activeChain = readState(root).tasks.find(task => task.type === 'source_recovery' && task.payload.sourceId === input.payload.sourceId && task.payload.configSha256 === input.payload.configSha256 && !['completed', 'cancelled'].includes(task.state));
    if (activeChain) {
      await withState(root, state => {
        const task = state.tasks.find(task => task.id === activeChain.id);
        task.sourceOccurrences ??= [];
        if (!task.sourceOccurrences.includes(receipt.startedAt)) task.sourceOccurrences.push(receipt.startedAt);
      });
      continue;
    }
    const { task, created } = await enqueueTask(root, { ...input, now });
    if (created) await withState(root, state => {
      const current = state.tasks.find(item => item.id === task.id);
      current.sourceOccurrences = [receipt.startedAt];
      if (input.retryAt) { current.state = 'retry_waiting'; current.availableAt = input.retryAt; }
    });
  }
  for (const target of receipt.targets.filter(target => !target.complete && !impl.recoveryTasks({ ...receipt, targets: [target] }, { now }).length)) {
    await addReview(root, { key: `source-blocked:${receipt.startedAt}:${target.sourceId}`, type: 'source_repair', title: `Search needs attention: ${target.name || target.provider || target.sourceId}`, payload: { source: target, receiptStartedAt: receipt.startedAt, requiredAction: 'Review source configuration or authenticate in the browser, then retry.' }, now });
  }
}

async function ingest(root, input, now) {
  if (!TYPES.has(input.type)) throw new Error(`Unsupported background task type: ${input.type}`);
  return enqueueTask(root, { ...input, now });
}

export async function discoverWork(root, { services, config = readConfig(root), now = new Date() } = {}) {
  const impl = services || await implementations();
  const state = readState(root);
  for (const input of await impl.discoverPipeline(root, { activation: state.activation })) await ingest(root, { ...input, type: 'role_packet' }, now);
  await withState(root, current => {
    const day = localDay(now, config.timezone);
    for (const task of current.tasks) {
      if (task.state === 'blocked' && task.result?.budgetDay && task.result.budgetDay !== day) {
        task.state = 'queued'; task.updatedAt = task.availableAt = now.toISOString();
      }
    }
  });
}

async function reviewOutcome(root, task, outcome, now) {
  for (const review of outcome.reviews || []) await addReview(root, { ...review, taskId: review.taskId || task.id, now });
  if (['review_ready', 'blocked', 'failed'].includes(outcome.state) && !outcome.result?.budgetDay) {
    await addReview(root, { key: `task:${task.id}:${task.attempts}`, taskId: task.id,
      type: task.type === 'source_recovery' ? 'source_repair' : task.type === 'mail_draft' ? outcome.state === 'review_ready' ? 'mail_draft' : 'mail_draft_input' : outcome.state === 'review_ready' ? 'job_packet' : 'required_input',
      title: outcome.state === 'review_ready' ? task.type === 'mail_draft' ? 'Mail draft ready for review' : 'Job packet ready for review' : `Automation needs attention: ${task.payload?.url || task.payload?.name || task.type}`,
      payload: { ...outcome.result, reason: outcome.reason, requiredAction: outcome.requiredAction || outcome.result?.requiredAction, state: outcome.state, checkpoint: outcome.checkpoint, inputFingerprint: task.inputFingerprint }, now });
  }
}

async function executeClaim(root, task, { impl, config, now, signal }) {
  const timer = setInterval(() => { heartbeatTask(root, task.id, task.claimToken).catch(() => {}); }, 15_000);
  let reservation, outcome, checkpointWrites = Promise.resolve(), budgetStarted = false;
  const budgetKind = task.type === 'role_packet' ? 'role' : task.type === 'mail_draft' ? 'draft' : null;
  const beforeAiStart = async stage => {
    if (!reservation || !budgetKind) throw new Error('AI stage has no active daily reservation');
    const marked = await markBudgetStarted(root, { kind: budgetKind, key: task.key, day: reservation.day, now });
    if (!marked) throw new Error('AI stage reservation disappeared before launch');
    budgetStarted = true;
    return stage;
  };
  const onEvent = event => {
    if (event.type !== 'checkpoint' || !event.checkpoint) return;
    checkpointWrites = checkpointWrites.then(() => withState(root, state => {
      const current = state.tasks.find(item => item.id === task.id);
      if (current?.lease?.token === task.claimToken) {
        current.checkpoint = event.checkpoint;
        current.stage = event.checkpoint.stage || 'evaluation';
      }
    }));
  };
  const failedStage = async checkpoint => {
    const stage = checkpoint?.stage || task.stage || (task.type === 'mail_draft' ? 'mail_draft' : 'evaluation');
    return withState(root, state => {
      const current = state.tasks.find(item => item.id === task.id);
      if (!current || current.lease?.token !== task.claimToken) return 3;
      current.stageFailures ??= {};
      current.stageFailures[stage] = (current.stageFailures[stage] || 0) + 1;
      return current.stageFailures[stage];
    });
  };
  try {
    if (task.type === 'role_packet') {
      const preflight = await impl.pipelinePreflight(root, task);
      if (!preflight.ok) outcome = { state: 'blocked', aiStarted: false, reason: preflight.reason, result: preflight };
      else if (task.inputFingerprint && preflight.inputFingerprint && task.inputFingerprint !== preflight.inputFingerprint) outcome = { state: 'blocked', aiStarted: false, reason: 'Source facts changed; review before regenerating this packet.', result: { requiredAction: 'Review the updated profile and retry this task.' } };
      else {
        if (preflight.inputFingerprint) await withState(root, state => { const current = state.tasks.find(item => item.id === task.id); current.inputFingerprint = preflight.inputFingerprint; });
        const eligible = { new: 0, backlog: 0 };
        for (const candidate of readState(root).tasks) if (candidate.type === 'role_packet' && due(candidate, now)) eligible[candidate.cohort || 'new']++;
        reservation = await reserveBudget(root, { kind: 'role', key: task.key, cohort: task.cohort || 'new', eligible, now, timezone: config.timezone });
        outcome = reservation.reserved ? await impl.executeRole(root, task, { config, signal, onEvent, beforeAiStart }) : { state: 'blocked', aiStarted: false, reason: 'Daily role allocation exhausted', result: { budgetDay: reservation.day } };
      }
    } else if (task.type === 'mail_draft') {
      reservation = await reserveBudget(root, { kind: 'draft', key: task.key, now, timezone: config.timezone });
      outcome = reservation.reserved ? await impl.executeMailDraft(root, task, { config, signal, beforeAiStart }) : { state: 'blocked', aiStarted: false, reason: 'Daily mail draft allocation exhausted', result: { budgetDay: reservation.day } };
    } else if (task.type === 'source_recovery') {
      let portals = {};
      try { portals = yaml.load(fs.readFileSync(path.join(root, 'portals.yml'), 'utf8')); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      outcome = await impl.executeRecovery(root, task, { config: portals, signal });
    } else throw new Error('Unknown automation task type');
    if (budgetKind && outcome.aiStarted === true && !budgetStarted && reservation?.reserved) await beforeAiStart(outcome.checkpoint?.stage);
    if (budgetKind && outcome.aiStarted === false) await releaseBudget(root, { kind: budgetKind, key: task.key, day: reservation?.day || localDay(now, config.timezone), cohort: task.cohort });
    if (outcome.state === 'waiting_retry') outcome.state = 'retry_waiting';
    if (outcome.state === 'needs_review') outcome.state = 'blocked';
    if (signal?.aborted) outcome = { ...outcome, state: 'retry_waiting', reason: 'Worker stopped; task checkpoint retained', retryAt: new Date().toISOString() };
    if (outcome.state === 'failed' && task.type !== 'source_recovery' && await failedStage(outcome.checkpoint) < 3) outcome = { ...outcome, state: 'retry_waiting', retryAt: new Date(now.getTime() + 60_000).toISOString() };
    if (outcome.nextPayload) await withState(root, state => { const current = state.tasks.find(item => item.id === task.id); if (current.lease?.token === task.claimToken) current.payload = outcome.nextPayload; });
    await checkpointWrites;
    writeAttempt(root, task, { at: now.toISOString(), state: outcome.state, reason: outcome.reason, result: outcome.result, checkpoint: outcome.checkpoint });
    const accepted = await finishTask(root, task.id, task.claimToken, { ...outcome });
    if (accepted) await reviewOutcome(root, task, outcome, now);
    return outcome;
  } catch (error) {
    if (budgetKind && !budgetStarted) {
      try { await releaseBudget(root, { kind: budgetKind, key: task.key, day: reservation?.day || localDay(now, config.timezone), cohort: task.cohort }); } catch { /* preserve the original failure */ }
    }
    outcome = { state: signal?.aborted || (task.type === 'source_recovery' ? task.attempts < 2 : await failedStage(task.checkpoint) < 3) ? 'retry_waiting' : 'failed', reason: error.message, retryAt: new Date(now.getTime() + 60_000).toISOString() };
    try { writeAttempt(root, task, { at: now.toISOString(), state: outcome.state, reason: outcome.reason }); } catch (receiptError) { if (receiptError.code !== 'EEXIST') throw receiptError; }
    if (await finishTask(root, task.id, task.claimToken, outcome)) await reviewOutcome(root, task, outcome, now);
    return outcome;
  } finally { clearInterval(timer); }
}

export async function runAiTick(root, { services, config = readConfig(root), now = new Date(), signal, owner = String(process.pid) } = {}) {
  const impl = services || await implementations(), state = readState(root);
  const day = localDay(now, config.timezone);
  const dailyRoles = state.budgets[day]?.roles || {};
  const reservedKeys = state.tasks.filter(task => task.type === 'role_packet' && due(task, now) && Object.hasOwn(dailyRoles, task.key)).map(task => task.key);
  const dailyDrafts = state.budgets[day]?.drafts || {};
  const reservedDraftKeys = state.tasks.filter(task => task.type === 'mail_draft' && due(task, now) && Object.hasOwn(dailyDrafts, task.key)).map(task => task.key);
  const eligible = { new: 0, backlog: 0 };
  for (const task of state.tasks) if (task.type === 'role_packet' && due(task, now)) eligible[task.cohort || 'new']++;
  const cohort = await chooseRoleCohort(root, eligible, { now, timezone: config.timezone, reservedKeys });
  const draftWaiting = state.tasks.some(task => task.type === 'mail_draft' && due(task, now));
  if (!cohort && !draftWaiting) return { status: 'idle' };
  const readiness = await impl.checkCodexLogin();
  await withState(root, current => { current.worker = { ...current.worker, authentication: { ...readiness, checkedAt: now.toISOString() } }; });
  if (!readiness.ok) {
    await addReview(root, { key: 'setup:codex', type: 'required_input', title: 'Sign in to Codex in this instance', payload: { reason: readiness.reason, requiredAction: 'Run codex login in this container; credentials must belong to this user.' }, now });
    return { status: 'blocked', reason: readiness.reason };
  }
  const mailFirst = draftWaiting && (state.worker?.lastAiType !== 'mail_draft' || !cohort);
  let task = mailFirst ? await claimTask(root, { types: ['mail_draft'], owner, preferredKeys: reservedDraftKeys, now }) : null;
  if (!task && cohort) task = await claimTask(root, { types: ['role_packet'], cohort, preferredKeys: reservedKeys, owner, now });
  if (!task && draftWaiting) task = await claimTask(root, { types: ['mail_draft'], owner, preferredKeys: reservedDraftKeys, now });
  if (!task) return { status: 'idle' };
  await withState(root, current => { current.worker = { ...current.worker, lastAiType: task.type }; });
  return executeClaim(root, task, { impl, config, now, signal });
}

export async function runScanTick(root, { services, config = readConfig(root), now = new Date(), signal, owner = String(process.pid) } = {}) {
  const impl = services || await implementations();
  if (setupBlockers(root).length) {
    await addReview(root, { key: 'setup:profile', type: 'required_input', title: 'Complete this instance’s profile', payload: { blockers: setupBlockers(root) }, now });
    return { status: 'blocked' };
  }
  if (readState(root).tasks.some(task => task.type === 'source_recovery' && due(task, now))) {
    return withResourceLock(scheduledRunnerResourcePath(scheduledStorePath(root)), async () => {
      const task = await claimTask(root, { types: ['source_recovery'], owner, now });
      return task ? executeClaim(root, task, { impl, config, now, signal }) : { status: 'idle' };
    }, { timeoutMs: 100 });
  }
  return impl.runScheduledTick(root, { signal, onReceipt: async (filename, result, job) => {
    let receipt;
    let reason = null;
    try {
      receipt = JSON.parse(fs.readFileSync(filename, 'utf8'));
      if (!receipt || receipt.schema !== 'career-ops.scan-run@1' || !Array.isArray(receipt.targets)) reason = 'Scanner receipt could not be read or validated: malformed or unsupported receipt.';
    } catch (error) {
      if (error?.code === 'ENOENT') reason = 'Scanner stopped before writing its source receipt.';
      else if (error instanceof SyntaxError) reason = 'Scanner receipt could not be read or validated: invalid JSON.';
      else throw error;
    }
    if (reason) {
      await addReview(root, { key: `scan-receipt:${path.basename(filename)}`, type: 'source_repair', title: `Scheduled scan needs attention: ${job?.name || job?.id || 'scan'}`, payload: { jobId: job?.id, receiptPath: filename, reason, scanState: result?.state, requiredAction: 'Inspect the scheduled run and retry after correcting the scanner failure.' }, now });
      return { status: 'failed', message: reason };
    }
    // Do not disguise automation-state write errors as malformed scan output.
    await ingestReceipt(root, receipt, { services: impl, now });
    return { status: 'success' };
  } });
}

export async function runMailTick(root, { services, config = readConfig(root), now = new Date(), signal } = {}) {
  const impl = services || await implementations();
  const result = await impl.pollMail(root, { config, now, signal });
  for (const input of result.tasks || []) await ingest(root, input, now);
  for (const review of result.reviews || []) await addReview(root, { ...review, now });
  return { ...result, tasks: undefined, reviews: undefined };
}

export async function workerOnce(root, options = {}) {
  const config = readConfig(root);
  if (!config.enabled || config.paused) return { status: config.paused ? 'paused' : 'disabled' };
  const services = await implementations(options.services);
  const at = options.now ? new Date(options.now) : new Date();
  await discoverWork(root, { ...options, services, config, now: at });
  const results = await Promise.allSettled([runScanTick(root, { ...options, services, config, now: at }), runMailTick(root, { ...options, services, config, now: at }), runAiTick(root, { ...options, services, config, now: at })]);
  await createDailyDigest(root, { now: at });
  return { status: 'finished', lanes: results.map(result => result.status === 'fulfilled' ? result.value : { status: 'failed', reason: result.reason.message }) };
}

export async function runWorker(root, { once = false, signal, services, intervalMs = 60_000, onError = () => {} } = {}) {
  const resource = path.join(root, 'data/automation/worker');
  if (once) return withResourceLock(resource, () => workerOnce(root, { services, signal }), { timeoutMs: 100 });
  return withResourceLock(resource, async () => {
    const impl = await implementations(services), owner = `${process.pid}:${randomUUID()}`, active = { scan: null, ai: null, mail: null };
    let lastTick = 0, lastError = null;
    const heartbeat = () => {
      const config = readConfig(root);
      if (!fs.existsSync(path.join(root, 'config/automation.json'))) return;
      const file = path.join(root, 'data/automation/worker-heartbeat.json');
      fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
      writeFileAtomic(file, JSON.stringify({ pid: process.pid, at: new Date().toISOString(), enabled: config.enabled, paused: config.paused, active: Object.fromEntries(Object.entries(active).map(([key, value]) => [key, Boolean(value)])), lastError }), { mode: 0o600 });
    };
    const startLane = (key, fn) => {
      if (active[key]) return;
      active[key] = Promise.resolve().then(fn).catch(error => { lastError = error.message; onError(error); }).finally(() => { active[key] = null; });
    };
    const timer = setInterval(() => { try { heartbeat(); } catch (error) { onError(error); } }, 15_000);
    try {
      while (!signal?.aborted) {
        try {
          const config = readConfig(root);
          heartbeat();
          if (config.enabled && !config.paused && Date.now() - lastTick >= intervalMs) {
            lastTick = Date.now();
            await discoverWork(root, { services: impl, config });
            const context = { services: impl, config, signal, owner };
            startLane('scan', () => runScanTick(root, context));
            startLane('mail', () => runMailTick(root, context));
            startLane('ai', () => runAiTick(root, context));
            await createDailyDigest(root);
          }
        } catch (error) { lastError = error.message; onError(error); }
        await new Promise(resolve => {
          const finish = () => { clearTimeout(timeout); signal?.removeEventListener('abort', finish); resolve(); };
          const timeout = setTimeout(finish, 1000);
          signal?.addEventListener('abort', finish, { once: true });
        });
      }
      await Promise.allSettled(Object.values(active).filter(Boolean));
    } finally { clearInterval(timer); }
    return { status: 'stopped' };
  }, { timeoutMs: 100 });
}
