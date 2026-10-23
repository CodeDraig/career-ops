import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { withResourceLock } from "../../web/src/lib/scheduled-jobs-store.mjs";
import { writeFileAtomic } from "../../tracker-utils.mjs";

const CONFIG_FILE = path.join("config", "automation.json");
const STATE_FILE = path.join("data", "automation", "state.json");
const ATTEMPTS_DIR = path.join("data", "automation", "attempts");
const EFFORTS = new Set(["", "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"]);
const COHORTS = new Set(["new", "backlog"]);
const TASK_STATES = new Set(["queued", "running", "retry_waiting", "blocked", "review_ready", "completed", "failed", "cancelled"]);
const REVIEW_STATES = new Set(["open", "resolved"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const DEFAULT_CONFIG = Object.freeze({
  enabled: false,
  paused: false,
  timezone: "America/New_York",
  dailyRoles: 20,
  dailyDrafts: 20,
  newSlots: 10,
  backlogSlots: 10,
  mailAccounts: [],
  model: "",
  effort: "",
});

export function emptyState() {
  return { version: 1, tasks: [], reviews: [], budgets: {}, watches: {}, digests: [], activation: null };
}

export function configPath(root) { return path.join(root, CONFIG_FILE); }
export function statePath(root) { return path.join(root, STATE_FILE); }

function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function iso(value, label) {
  const parsed = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(parsed.getTime())) throw new Error(`${label} must be a valid timestamp`);
  return parsed.toISOString();
}
function timestampMs(value) { return new Date(value).getTime(); }
function ensurePrivateDir(dir) { fs.mkdirSync(dir, { recursive: true, mode: 0o700 }); }
function writePrivate(file, data) {
  ensurePrivateDir(path.dirname(file));
  const serialized = JSON.stringify(data, null, 2);
  if (typeof serialized !== "string") throw new Error(`cannot serialize automation data for ${file}`);
  writeFileAtomic(file, `${serialized}\n`, { mode: 0o600 });
}
function configError(file, error) {
  return new Error(`Invalid automation config at ${file}: ${error instanceof Error ? error.message : String(error)}`);
}
function stateError(file, error) {
  return new Error(`Invalid automation state at ${file}: ${error instanceof Error ? error.message : String(error)}`);
}

function validateConfig(config) {
  if (!isObject(config)) throw new Error("config must be an object");
  const allowed = new Set(Object.keys(DEFAULT_CONFIG));
  for (const key of Object.keys(config)) if (!allowed.has(key)) throw new Error(`unknown setting ${key}`);
  for (const key of ["enabled", "paused"]) if (typeof config[key] !== "boolean") throw new Error(`${key} must be boolean`);
  for (const key of ["dailyRoles", "dailyDrafts", "newSlots", "backlogSlots"]) {
    if (!Number.isSafeInteger(config[key]) || config[key] < 0) throw new Error(`${key} must be a non-negative integer`);
  }
  for (const key of ["dailyRoles", "dailyDrafts"]) if (config[key] > 20) throw new Error(`${key} must not exceed the per-instance cap of 20`);
  if (typeof config.timezone !== "string" || !config.timezone.trim()) throw new Error("timezone must be a non-empty IANA timezone");
  try { new Intl.DateTimeFormat("en-US", { timeZone: config.timezone }).format(0); } catch { throw new Error(`invalid timezone ${config.timezone}`); }
  if (!Array.isArray(config.mailAccounts) || config.mailAccounts.some((x) => typeof x !== "string" || !x.trim())) throw new Error("mailAccounts must be an array of non-empty account IDs");
  if (new Set(config.mailAccounts).size !== config.mailAccounts.length) throw new Error("mailAccounts must not contain duplicates");
  for (const key of ["model", "effort"]) if (typeof config[key] !== "string") throw new Error(`${key} must be a string`);
  if (!EFFORTS.has(config.effort)) throw new Error(`unsupported effort ${config.effort}`);
  if (config.model.length > 200 || config.effort.length > 20) throw new Error("model or effort setting is too long");
  return config;
}

function mergedConfig(value) {
  if (!isObject(value)) throw new Error("config root must be an object");
  return validateConfig({ ...DEFAULT_CONFIG, ...value });
}

export function readConfig(root) {
  const file = configPath(root);
  try { return mergedConfig(JSON.parse(fs.readFileSync(file, "utf8"))); }
  catch (error) {
    if (error?.code === "ENOENT") return { ...DEFAULT_CONFIG, mailAccounts: [] };
    throw configError(file, error);
  }
}

export async function writeConfig(root, patch) {
  if (!isObject(patch)) throw new Error("config patch must be an object");
  const file = configPath(root);
  return withResourceLock(file, async () => {
    let current = { ...DEFAULT_CONFIG, mailAccounts: [] };
    try { current = mergedConfig(JSON.parse(fs.readFileSync(file, "utf8"))); }
    catch (error) { if (error?.code !== "ENOENT") throw configError(file, error); }
    const next = mergedConfig({ ...current, ...patch });
    writePrivate(file, next);
    return next;
  });
}

function validateState(state) {
  if (!isObject(state) || state.version !== 1) throw new Error("state must have version 1");
  for (const key of ["tasks", "reviews", "digests"]) if (!Array.isArray(state[key])) throw new Error(`${key} must be an array`);
  for (const key of ["budgets", "watches"]) if (!isObject(state[key])) throw new Error(`${key} must be an object`);
  for (const [day, bucket] of Object.entries(state.budgets)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !isObject(bucket)) throw new Error(`invalid budget bucket ${day}`);
    for (const key of ["roles", "drafts", "cohorts"]) if (!isObject(bucket[key])) throw new Error(`budget ${day}.${key} must be an object`);
    for (const cohort of COHORTS) if (!isObject(bucket.cohorts[cohort])) throw new Error(`budget ${day}.cohorts.${cohort} must be an object`);
    for (const [key, reservation] of Object.entries(bucket.roles)) {
      if (!isObject(reservation) || !COHORTS.has(reservation.cohort) || typeof reservation.borrowed !== "boolean") throw new Error(`invalid role budget reservation ${key}`);
      iso(reservation.at, `budget ${day}.roles.${key}.at`);
      if (reservation.startedAt !== undefined && reservation.startedAt !== null) iso(reservation.startedAt, `budget ${day}.roles.${key}.startedAt`);
      if (!Object.hasOwn(bucket.cohorts[reservation.cohort], key)) throw new Error(`missing cohort reservation ${key}`);
    }
    for (const [key, reservation] of Object.entries(bucket.drafts)) {
      if (!isObject(reservation)) throw new Error(`invalid draft budget reservation ${key}`);
      iso(reservation.at, `budget ${day}.drafts.${key}.at`);
      if (reservation.startedAt !== undefined && reservation.startedAt !== null) iso(reservation.startedAt, `budget ${day}.drafts.${key}.startedAt`);
    }
  }
  if (state.activation !== null && !isObject(state.activation)) throw new Error("activation must be an object or null");
  const taskIds = new Set(); const taskKeys = new Set();
  for (const task of state.tasks) {
    if (!isObject(task) || typeof task.id !== "string" || !task.id || typeof task.key !== "string" || !task.key || typeof task.type !== "string" || !TASK_STATES.has(task.state)) throw new Error("invalid automation task");
    if (taskIds.has(task.id) || taskKeys.has(task.key)) throw new Error("duplicate automation task id or key");
    taskIds.add(task.id); taskKeys.add(task.key);
    iso(task.createdAt, `task ${task.id}.createdAt`); iso(task.updatedAt, `task ${task.id}.updatedAt`);
    if (!Number.isSafeInteger(task.attempts) || task.attempts < 0) throw new Error(`invalid attempts for task ${task.id}`);
    if (task.cohort !== undefined && !COHORTS.has(task.cohort)) throw new Error(`invalid cohort for task ${task.id}`);
    if (task.lease !== undefined && task.lease !== null) {
      if (!isObject(task.lease) || typeof task.lease.owner !== "string" || typeof task.lease.token !== "string") throw new Error(`invalid lease for task ${task.id}`);
      iso(task.lease.expiresAt, `task ${task.id}.lease.expiresAt`);
    }
  }
  const reviewIds = new Set(); const reviewKeys = new Set();
  for (const review of state.reviews) {
    if (!isObject(review) || typeof review.id !== "string" || !review.id || typeof review.key !== "string" || !review.key || typeof review.type !== "string" || !REVIEW_STATES.has(review.state)) throw new Error("invalid automation review item");
    if (reviewIds.has(review.id) || reviewKeys.has(review.key)) throw new Error("duplicate automation review id or key");
    reviewIds.add(review.id); reviewKeys.add(review.key);
    if (!Number.isSafeInteger(review.revision) || review.revision < 1) throw new Error(`invalid review revision for ${review.id}`);
    iso(review.createdAt, `review ${review.id}.createdAt`); iso(review.updatedAt, `review ${review.id}.updatedAt`);
  }
  return state;
}

function readStateFile(file) {
  try { return validateState(JSON.parse(fs.readFileSync(file, "utf8"))); }
  catch (error) {
    if (error?.code === "ENOENT") return emptyState();
    throw stateError(file, error);
  }
}

export function readState(root) { return readStateFile(statePath(root)); }

export async function withState(root, mutator) {
  const file = statePath(root);
  return withResourceLock(file, async () => {
    const state = readStateFile(file);
    const result = await mutator(state);
    validateState(state);
    writePrivate(file, state);
    return result;
  });
}

export async function enqueueTask(root, input) {
  if (!isObject(input) || typeof input.key !== "string" || !input.key.trim() || typeof input.type !== "string" || !input.type.trim()) throw new Error("task key and type are required");
  const now = iso(input.now ?? new Date(), "now");
  return withState(root, (state) => {
    const existing = state.tasks.find((task) => task.key === input.key);
    if (existing) return { task: existing, created: false };
    const task = {
      id: randomUUID(), key: input.key, type: input.type, payload: input.payload ?? {},
      ...(input.cohort === undefined ? {} : { cohort: input.cohort }),
      ...(input.inputFingerprint === undefined ? {} : { inputFingerprint: input.inputFingerprint }),
      state: "queued", attempts: 0, createdAt: now, updatedAt: now, availableAt: now, lease: null,
    };
    state.tasks.push(task);
    return { task, created: true };
  });
}

export async function claimTask(root, { types, owner, cohort, preferredKeys = [], now = new Date(), leaseMs = 60_000 } = {}) {
  if (!Array.isArray(types) || !types.length || types.some((x) => typeof x !== "string")) throw new Error("types must be a non-empty array");
  if (!Array.isArray(preferredKeys) || preferredKeys.some((x) => typeof x !== "string")) throw new Error("preferredKeys must be an array of task keys");
  if (typeof owner !== "string" || !owner.trim()) throw new Error("owner is required");
  if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) throw new Error("leaseMs must be a positive integer");
  const at = iso(now, "now"); const millis = timestampMs(at);
  return withState(root, (state) => {
    for (const task of state.tasks) {
      if (task.state === "running" && task.lease && timestampMs(task.lease.expiresAt) <= millis) {
        task.state = "retry_waiting"; task.availableAt = at; task.lease = null; task.updatedAt = at;
        task.lastReason = "worker lease expired";
      }
    }
    const matches = candidate => types.includes(candidate.type)
      && (cohort === undefined || candidate.cohort === cohort)
      && (candidate.state === "queued" || (candidate.state === "retry_waiting" && timestampMs(candidate.availableAt) <= millis));
    const preferred = new Set(preferredKeys);
    const task = state.tasks.find(candidate => matches(candidate) && preferred.has(candidate.key)) || state.tasks.find(matches);
    if (!task) return null;
    const token = randomUUID();
    task.state = "running"; task.attempts += 1; task.updatedAt = at;
    task.lease = { owner, token, expiresAt: new Date(millis + leaseMs).toISOString() };
    return { ...task, claimToken: token };
  });
}

export async function heartbeatTask(root, id, token, { now = new Date(), leaseMs = 60_000 } = {}) {
  const at = iso(now, "now");
  if (!Number.isSafeInteger(leaseMs) || leaseMs <= 0) throw new Error("leaseMs must be a positive integer");
  return withState(root, (state) => {
    const task = state.tasks.find((item) => item.id === id);
    if (!task || task.state !== "running" || task.lease?.token !== token || timestampMs(task.lease.expiresAt) <= timestampMs(at)) return false;
    task.lease.expiresAt = new Date(timestampMs(at) + leaseMs).toISOString(); task.updatedAt = at;
    return true;
  });
}

const FINISH_STATES = new Set(["retry_waiting", "blocked", "review_ready", "completed", "failed", "cancelled"]);
export async function finishTask(root, id, token, { state: nextState, result, checkpoint, stage, reason, retryAt, now = new Date() } = {}) {
  if (!FINISH_STATES.has(nextState)) throw new Error(`invalid task finish state ${nextState}`);
  const at = iso(now, "now");
  return withState(root, (state) => {
    const task = state.tasks.find((item) => item.id === id);
    if (!task || task.state !== "running" || task.lease?.token !== token || timestampMs(task.lease.expiresAt) <= timestampMs(at)) return false;
    task.state = nextState; task.updatedAt = at; task.lease = null;
    if (result !== undefined) task.result = result;
    if (checkpoint !== undefined) task.checkpoint = checkpoint;
    if (stage !== undefined) task.stage = stage;
    if (reason !== undefined) task.lastReason = String(reason);
    if (nextState === "retry_waiting") task.availableAt = iso(retryAt ?? at, "retryAt");
    return true;
  });
}

/** Release a same-day reservation only when preflight prevented work from starting. */
export async function releaseBudget(root, { kind, key, day, cohort } = {}) {
  if (!new Set(["role", "draft"]).has(kind)) throw new Error("kind must be role or draft");
  if (typeof key !== "string" || !key.trim()) throw new Error("budget key is required");
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("day must be YYYY-MM-DD");
  if (kind === "role" && !COHORTS.has(cohort)) throw new Error("role budget release requires cohort new or backlog");
  return withState(root, (state) => {
    const bucket = state.budgets[day];
    if (!bucket) return false;
    const ledger = kind === "role" ? bucket.roles : bucket.drafts;
    if (!isObject(ledger) || !Object.hasOwn(ledger, key)) return false;
    // Old reservations without a lifecycle marker are conservatively treated
    // as spent. Only an explicitly unstarted reservation can be returned.
    if (!Object.hasOwn(ledger[key], "startedAt") || ledger[key].startedAt !== null) return false;
    if (kind === "role") {
      const reservation = ledger[key];
      if (reservation?.cohort !== cohort) return false;
      delete bucket.cohorts?.[cohort]?.[key];
    }
    delete ledger[key];
    return true;
  });
}

/** Persist the point immediately before a reserved AI stage is spawned. */
export async function markBudgetStarted(root, { kind, key, day, now = new Date() } = {}) {
  if (!new Set(["role", "draft"]).has(kind)) throw new Error("kind must be role or draft");
  if (typeof key !== "string" || !key.trim()) throw new Error("budget key is required");
  if (typeof day !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error("day must be YYYY-MM-DD");
  const at = iso(now, "now");
  return withState(root, (state) => {
    const reservation = state.budgets[day]?.[kind === "role" ? "roles" : "drafts"]?.[key];
    if (!reservation) return false;
    if (reservation.startedAt == null) reservation.startedAt = at;
    return true;
  });
}

export async function addReview(root, input) {
  if (!isObject(input) || typeof input.key !== "string" || !input.key.trim() || typeof input.type !== "string" || typeof input.title !== "string") throw new Error("review key, type and title are required");
  const now = iso(input.now ?? new Date(), "now");
  return withState(root, (state) => {
    const existing = state.reviews.find((item) => item.key === input.key);
    if (existing) return { review: existing, created: false };
    const review = { id: randomUUID(), key: input.key, type: input.type, title: input.title, payload: input.payload ?? {}, ...(input.taskId ? { taskId: input.taskId } : {}), state: "open", revision: 1, createdAt: now, updatedAt: now };
    state.reviews.push(review);
    return { review, created: true };
  });
}

export async function resolveReview(root, id, expectedRevision, action, { now = new Date() } = {}) {
  const at = iso(now, "now");
  return withState(root, (state) => {
    const review = state.reviews.find((item) => item.id === id);
    if (!review) { const error = new Error(`review item ${id} not found`); error.status = 404; throw error; }
    if (review.revision !== expectedRevision || review.state !== "open") {
      const error = new Error(`review item changed; current revision is ${review.revision}`); error.status = 409; error.current = review; throw error;
    }
    review.state = "resolved"; review.revision += 1; review.updatedAt = at; review.resolution = action;
    return review;
  });
}

export async function reserveBudget(root, { kind, key, cohort, eligible, now = new Date(), timezone = DEFAULT_CONFIG.timezone, limit } = {}) {
  if (!new Set(["role", "draft"]).has(kind)) throw new Error("kind must be role or draft");
  if (typeof key !== "string" || !key.trim()) throw new Error("budget key is required");
  if (kind === "role" && !COHORTS.has(cohort)) throw new Error("role budget requires cohort new or backlog");
  const at = iso(now, "now");
  let day;
  try { day = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at)); }
  catch { throw new Error(`invalid timezone ${timezone}`); }
  return withState(root, (state) => {
    const bucket = state.budgets[day] ??= { roles: {}, drafts: {}, cohorts: { new: {}, backlog: {} } };
    bucket.roles ??= {}; bucket.drafts ??= {}; bucket.cohorts ??= { new: {}, backlog: {} };
    bucket.cohorts.new ??= {}; bucket.cohorts.backlog ??= {};
    const ledger = kind === "role" ? bucket.roles : bucket.drafts;
    const prior = ledger[key];
    if (prior) return { reserved: true, created: false, reservation: prior, day };
    const config = readConfig(root);
    const totalLimit = limit ?? (kind === "role" ? config.dailyRoles : config.dailyDrafts);
    if (!Number.isSafeInteger(totalLimit) || totalLimit < 0) throw new Error("limit must be a non-negative integer");
    const totalCount = Object.keys(ledger).length;
    if (totalCount >= totalLimit) return { reserved: false, reason: "daily_limit", day, used: totalCount, limit: totalLimit };
    if (kind === "role") {
      const cohortLimit = cohort === "new" ? config.newSlots : config.backlogSlots;
      const used = Object.keys(bucket.cohorts[cohort]).length;
      const other = cohort === "new" ? "backlog" : "new";
      const eligibleOther = Number.isSafeInteger(eligible?.[other]) ? eligible[other] : Infinity;
      const mayBorrow = used >= cohortLimit && eligibleOther === 0;
      if (used >= cohortLimit && !mayBorrow) return { reserved: false, reason: "cohort_limit", day, cohort, used, limit: cohortLimit };
      bucket.cohorts[cohort][key] = { at, borrowed: used >= cohortLimit };
    }
    const reservation = { at, startedAt: null, ...(kind === "role" ? { cohort, borrowed: bucket.cohorts[cohort][key].borrowed } : {}) };
    ledger[key] = reservation;
    return { reserved: true, created: true, reservation, day };
  });
}

export async function chooseRoleCohort(root, eligible, { now = new Date(), timezone = DEFAULT_CONFIG.timezone, reservedKeys = [] } = {}) {
  if (!isObject(eligible) || !Number.isSafeInteger(eligible.new) || eligible.new < 0 || !Number.isSafeInteger(eligible.backlog) || eligible.backlog < 0) throw new Error("eligible must contain non-negative new and backlog counts");
  const at = iso(now, "now");
  const day = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
  const state = readState(root); const bucket = state.budgets[day] ?? { roles: {}, cohorts: { new: {}, backlog: {} } };
  const config = readConfig(root);
  const eligibleReserved = new Set(reservedKeys.filter(key => Object.hasOwn(bucket.roles ?? {}, key)));
  const reservedCohorts = ["new", "backlog"].filter(cohort => state.tasks.some(task => task.type === "role_packet" && (task.cohort || "new") === cohort && eligibleReserved.has(task.key)));
  reservedCohorts.sort((a, b) => Object.keys(bucket.cohorts?.[a] ?? {}).length - Object.keys(bucket.cohorts?.[b] ?? {}).length || (a === "backlog" ? -1 : 1));
  // Work already allocated today may retry without a second charge, even if
  // its allocation would prevent another new task from entering the cohort.
  if (reservedCohorts.length) return reservedCohorts[0];
  if (Object.keys(bucket.roles ?? {}).length >= config.dailyRoles) return null;
  const available = ["new", "backlog"].map((cohort) => ({ cohort, eligible: eligible[cohort], used: Object.keys(bucket.cohorts?.[cohort] ?? {}).length, cap: cohort === "new" ? config.newSlots : config.backlogSlots }));
      const runnable = available.filter((x) => x.eligible > 0 && (x.used < x.cap || available.find((other) => other.cohort !== x.cohort).eligible === 0));
  runnable.sort((a, b) => a.used - b.used || (a.cohort === "backlog" ? -1 : 1));
  return runnable[0]?.cohort ?? null;
}

export function writeAttempt(root, task, receipt) {
  if (!isObject(task) || typeof task.id !== "string" || !UUID_RE.test(task.id)) throw new Error("task id must be a UUID");
  const attempt = Number.isSafeInteger(task.attempts) && task.attempts > 0 ? task.attempts : 1;
  const serialized = JSON.stringify({ ...(isObject(receipt) ? receipt : { receipt }), taskId: task.id, attempt }, null, 2);
  if (typeof serialized !== "string") throw new Error("attempt receipt is not serializable");
  const dir = path.join(root, ATTEMPTS_DIR, task.id); ensurePrivateDir(dir);
  const file = path.join(dir, `${String(attempt).padStart(4, "0")}.json`);
  const fd = fs.openSync(file, "wx", 0o600);
  try { fs.writeFileSync(fd, `${serialized}\n`, "utf8"); }
  finally { fs.closeSync(fd); }
  return file;
}
