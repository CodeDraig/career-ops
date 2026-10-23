import fs from 'node:fs';
import path from 'node:path';
import { withResourceLock } from '../../web/src/lib/scheduled-jobs-store.mjs';
import { readConfig, writeConfig, readState, withState, resolveReview, enqueueTask } from './store.mjs';

export function localDay(now = new Date(), timezone = 'America/New_York') {
  return new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(now));
}

export function setupBlockers(root) {
  const missing = ['cv.md', 'config/profile.yml', 'modes/_profile.md', 'portals.yml'].filter(file => !fs.existsSync(path.join(root, file)));
  return missing.length ? [{ code: 'profile_setup', message: 'Complete this instance’s Career-Ops profile before scheduling searches or preparing job packets.', missing }] : [];
}

export async function automationStatus(root, { now = new Date() } = {}) {
  const config = readConfig(root), state = readState(root), day = localDay(now, config.timezone);
  const bucket = state.budgets[day] || {};
  let heartbeat = null;
  try { heartbeat = JSON.parse(fs.readFileSync(path.join(root, 'data/automation/worker-heartbeat.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const healthy = Boolean(heartbeat && new Date(now).getTime() - Date.parse(heartbeat.at) < 180_000);
  return {
    config, day, worker: { ...heartbeat, healthy }, activation: state.activation,
    budgets: { roles: { used: Object.keys(bucket.roles || {}).length, limit: config.dailyRoles }, drafts: { used: Object.keys(bucket.drafts || {}).length, limit: config.dailyDrafts }, cohorts: { new: Object.keys(bucket.cohorts?.new || {}).length, backlog: Object.keys(bucket.cohorts?.backlog || {}).length } },
    tasks: state.tasks, reviews: state.reviews.filter(item => item.state === 'open'), digests: [...state.digests].reverse(),
    blockers: [...setupBlockers(root), ...(state.worker?.authentication?.ok === false ? [{ code: 'codex_authentication', message: state.worker.authentication.reason }] : []), ...state.tasks.filter(task => task.state === 'blocked').map(task => ({ code: 'task_blocked', taskId: task.id, message: task.lastReason, requiredAction: task.result?.requiredAction }))],
  };
}

export async function configureAutomation(root, patch) {
  const initialize = patch?.enabled === true && !readState(root).activation;
  // Do not expose an enabled worker before the immutable backlog boundary exists.
  const config = await writeConfig(root, initialize ? { ...patch, enabled: false } : patch);
  if (initialize) {
    const { discoverPipeline } = await import('./pipeline.mjs');
    const state = readState(root);
    if (!state.activation) {
      const pending = await discoverPipeline(root, { activation: null });
      await withState(root, current => {
        current.activation ??= { at: new Date().toISOString(), backlogUrls: pending.map(item => item.url || item.payload?.url).filter(Boolean) };
      });
    }
  }
  return initialize ? writeConfig(root, { enabled: true }) : config;
}

export const pauseAutomation = root => writeConfig(root, { paused: true });
export const resumeAutomation = root => writeConfig(root, { paused: false });

export async function retryTask(root, id) {
  const previous = readState(root).tasks.find(item => item.id === id);
  if (!previous) throw Object.assign(new Error('Automation task not found'), { status: 404 });
  if (!['blocked', 'failed', 'retry_waiting', 'cancelled'].includes(previous.state)) throw Object.assign(new Error('Only blocked, failed, waiting or cancelled tasks can be retried'), { status: 409, current: previous });
  if (previous?.type === 'role_packet' && previous.inputFingerprint) {
    const { profilePreflight } = await import('./pipeline.mjs');
    const current = await profilePreflight(root, previous);
    if (current.ok && current.inputFingerprint !== previous.inputFingerprint) {
      const { task } = await enqueueTask(root, { key: `${previous.key}:revision:${current.inputFingerprint}`, type: 'role_packet', cohort: previous.cohort || 'new', inputFingerprint: current.inputFingerprint, payload: { ...previous.payload, forceReevaluation: true, previousTaskId: previous.id } });
      await withState(root, state => {
        const old = state.tasks.find(item => item.id === id);
        if (old && old.state !== 'running') { old.state = 'cancelled'; old.updatedAt = new Date().toISOString(); old.supersededBy = task.id; }
      });
      return task;
    }
  }
  return withState(root, state => {
    const task = state.tasks.find(item => item.id === id);
    if (!task) throw Object.assign(new Error('Automation task not found'), { status: 404 });
    if (!['blocked', 'failed', 'retry_waiting', 'cancelled'].includes(task.state)) throw Object.assign(new Error('Only blocked, failed, waiting or cancelled tasks can be retried'), { status: 409, current: task });
    task.state = 'queued'; task.availableAt = task.updatedAt = new Date().toISOString(); task.lease = null;
    // Keep attempts and reservations: a manual retry is not a budget reset.
    return task;
  });
}

export async function listReviews(root, { state: filter = 'open', type, id } = {}) {
  const records = readState(root).reviews.filter(item => (!filter || filter === 'all' || item.state === filter) && (!type || item.type === type));
  if (id) {
    const record = readState(root).reviews.find(item => item.id === id);
    if (!record) throw Object.assign(new Error('Review item not found'), { status: 404 });
    return record;
  }
  return records;
}

export async function reviewAction(root, id, input) {
  if (!input || !Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 1 || typeof input.action !== 'string') throw Object.assign(new Error('action and expectedRevision are required'), { status: 400 });
  return withResourceLock(path.join(root, 'data/automation/review-actions'), async () => {
    const item = await listReviews(root, { id });
    if (item.revision !== input.expectedRevision || item.state !== 'open') throw Object.assign(new Error('Review item changed; reload before acting'), { status: 409, current: item });
    let result;
    if (['match', 'approve_status', 'open_draft'].includes(input.action)) {
      const { mailReviewAction } = await import('./mail.mjs');
      if (!item.type.startsWith('mail_')) throw Object.assign(new Error('This action requires a mail review item'), { status: 400 });
      result = await mailReviewAction(root, item, input);
      if (input.action === 'open_draft') return { review: item, result };
    } else if (input.action === 'retry') {
      if (!item.taskId) throw Object.assign(new Error('Review item has no retryable task'), { status: 400 });
      result = await retryTask(root, item.taskId);
    } else if (input.action === 'answer') {
      if (!item.taskId || typeof input.answer !== 'string' || !input.answer.trim()) throw Object.assign(new Error('An answer and associated task are required'), { status: 400 });
      result = await withState(root, state => {
        const task = state.tasks.find(task => task.id === item.taskId);
        if (!task || task.state !== 'blocked') throw Object.assign(new Error('Task is no longer waiting for input'), { status: 409 });
        task.payload = { ...task.payload, reviewAnswer: input.answer.trim() };
        task.state = 'queued'; task.availableAt = task.updatedAt = new Date().toISOString();
        return task;
      });
    } else if (!['reviewed', 'dismiss'].includes(input.action)) {
      throw Object.assign(new Error('Unsupported review action'), { status: 400 });
    }
    const review = await resolveReview(root, id, input.expectedRevision, { action: input.action });
    return { review, result };
  });
}

export async function createDailyDigest(root, { now = new Date() } = {}) {
  const config = readConfig(root), day = localDay(now, config.timezone);
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: config.timezone, hour: '2-digit', hourCycle: 'h23' }).format(new Date(now)));
  if (hour < 8) return null;
  return withState(root, state => {
    if (state.digests.some(digest => digest.day === day)) return null;
    const previousAt = state.digests.at(-1)?.at || state.activation?.at || '1970-01-01T00:00:00.000Z';
    const changed = state.tasks.filter(task => Date.parse(task.updatedAt) > Date.parse(previousAt));
    const digest = { day, at: new Date(now).toISOString(), since: previousAt, counts: { completed: changed.filter(task => ['completed', 'review_ready'].includes(task.state)).length, failed: changed.filter(task => task.state === 'failed').length, blocked: state.tasks.filter(task => task.state === 'blocked').length }, reviewIds: state.reviews.filter(item => item.state === 'open').map(item => item.id), budgets: state.budgets[day] || {}, sourceFailures: state.tasks.filter(task => task.type === 'source_recovery' && ['failed', 'blocked'].includes(task.state)).map(task => ({ taskId: task.id, reason: task.lastReason })) };
    state.digests.push(digest);
    return digest;
  });
}
