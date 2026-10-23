import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  DEFAULT_CONFIG, addReview, claimTask, chooseRoleCohort, enqueueTask, finishTask,
  heartbeatTask, readConfig, readState, reserveBudget, resolveReview, statePath,
  releaseBudget, markBudgetStarted, withState, writeAttempt, writeConfig,
} from "../lib/automation/store.mjs";

function tempRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-automation-store-")); }
function cleanup(root) { fs.rmSync(root, { recursive: true, force: true }); }

test("readers return defaults without creating config or state", () => {
  const root = tempRoot();
  try {
    assert.deepEqual(readConfig(root), DEFAULT_CONFIG);
    assert.deepEqual(readState(root), { version: 1, tasks: [], reviews: [], budgets: {}, watches: {}, digests: [], activation: null });
    assert.equal(fs.existsSync(path.join(root, "config")), false);
    assert.equal(fs.existsSync(statePath(root)), false);
  } finally { cleanup(root); }
});

test("config writes are explicit, partial, strict, and private", async () => {
  const root = tempRoot();
  try {
    const config = await writeConfig(root, { enabled: true, mailAccounts: ["thomas"], effort: "high" });
    assert.equal(config.enabled, true);
    assert.equal(config.timezone, "America/New_York");
    assert.deepEqual(readConfig(root), config);
    assert.equal(fs.statSync(path.join(root, "config", "automation.json")).mode & 0o777, 0o600);
    await assert.rejects(writeConfig(root, { dailyRoles: -1 }), /dailyRoles/);
    await assert.rejects(writeConfig(root, { unexpected: 1 }), /unknown setting/);
    await assert.rejects(writeConfig(root, { dailyRoles: 21 }), /per-instance cap of 20/);
    await assert.rejects(writeConfig(root, { dailyDrafts: 21 }), /per-instance cap of 20/);
    assert.deepEqual(readConfig(root), config);
  } finally { cleanup(root); }
});

test("writes keep pre-existing directory permissions", async () => {
  const root = tempRoot();
  try {
    const configDir = path.join(root, "config");
    fs.mkdirSync(configDir, { mode: 0o755 });
    fs.chmodSync(configDir, 0o755);
    await writeConfig(root, { enabled: true });
    assert.equal(fs.statSync(configDir).mode & 0o777, 0o755);
  } finally { cleanup(root); }
});

test("concurrent state mutations retain every update and create private files", async () => {
  const root = tempRoot();
  try {
    await Promise.all(Array.from({ length: 24 }, (_, i) => withState(root, async (state) => {
      await new Promise((resolve) => setTimeout(resolve, i % 3));
      state.digests.push({ id: i });
    })));
    assert.equal(readState(root).digests.length, 24);
    assert.equal(fs.statSync(statePath(root)).mode & 0o777, 0o600);
  } finally { cleanup(root); }
});

test("task keys deduplicate and claims recover expired leases with fresh tokens", async () => {
  const root = tempRoot();
  try {
    const first = await enqueueTask(root, { key: "role:1", type: "evaluate", cohort: "new", payload: { url: "https://example.test/1" }, now: "2026-10-23T12:00:00Z" });
    const duplicate = await enqueueTask(root, { key: "role:1", type: "evaluate", payload: { url: "different" } });
    assert.equal(first.created, true);
    assert.equal(duplicate.created, false);
    assert.equal(duplicate.task.id, first.task.id);
    const claimed = await claimTask(root, { types: ["evaluate"], owner: "worker-a", cohort: "new", now: "2026-10-23T12:00:00Z", leaseMs: 1_000 });
    assert.equal(claimed.attempts, 1);
    assert.equal(await heartbeatTask(root, claimed.id, claimed.claimToken, { now: "2026-10-23T12:00:00.500Z", leaseMs: 1_000 }), true);
    assert.equal(await heartbeatTask(root, claimed.id, claimed.claimToken, { now: "2026-10-23T12:00:01.500Z", leaseMs: 1_000 }), false);
    assert.equal(await finishTask(root, claimed.id, claimed.claimToken, { state: "completed", now: "2026-10-23T12:00:01.500Z" }), false);
    assert.equal(await finishTask(root, claimed.id, "wrong-token", { state: "completed" }), false);
    const recovered = await claimTask(root, { types: ["evaluate"], owner: "worker-b", now: "2026-10-23T12:00:03Z", leaseMs: 5_000 });
    assert.equal(recovered.id, claimed.id);
    assert.equal(recovered.attempts, 2);
    assert.notEqual(recovered.claimToken, claimed.claimToken);
    assert.equal(await finishTask(root, claimed.id, claimed.claimToken, { state: "completed" }), false);
    assert.equal(await finishTask(root, recovered.id, recovered.claimToken, { state: "retry_waiting", retryAt: "2026-10-23T12:10:00Z", reason: "temporary", now: "2026-10-23T12:00:04Z" }), true);
    assert.equal(await claimTask(root, { types: ["evaluate"], owner: "worker-c", now: "2026-10-23T12:09:59Z" }), null);
    assert.ok(await claimTask(root, { types: ["evaluate"], owner: "worker-c", now: "2026-10-23T12:10:00Z" }));
  } finally { cleanup(root); }
});

test("role and draft reservations are idempotent, capped, cohort-aware, and roll over by local day", async () => {
  const root = tempRoot();
  try {
    await writeConfig(root, { dailyRoles: 3, dailyDrafts: 1, newSlots: 1, backlogSlots: 1 });
    const now = "2026-10-23T16:00:00Z";
    assert.equal(await chooseRoleCohort(root, { new: 2, backlog: 2 }, { now }), "backlog");
    assert.equal((await reserveBudget(root, { kind: "role", key: "new-1", cohort: "new", eligible: { new: 2, backlog: 1 }, now })).reserved, true);
    assert.equal((await reserveBudget(root, { kind: "role", key: "new-1", cohort: "new", now })).created, false);
    assert.equal((await reserveBudget(root, { kind: "role", key: "new-2", cohort: "new", eligible: { new: 2, backlog: 1 }, now })).reserved, false);
    assert.equal((await reserveBudget(root, { kind: "role", key: "new-2", cohort: "new", eligible: { new: 2, backlog: 0 }, now })).reservation.borrowed, true);
    assert.equal((await reserveBudget(root, { kind: "role", key: "back-1", cohort: "backlog", now })).reserved, true);
    assert.equal((await reserveBudget(root, { kind: "role", key: "last", cohort: "new", eligible: { new: 0, backlog: 1 }, now })).reserved, false);
    assert.equal((await reserveBudget(root, { kind: "draft", key: "d1", now })).reserved, true);
    assert.equal((await reserveBudget(root, { kind: "draft", key: "d2", now })).reserved, false);
    assert.equal((await reserveBudget(root, { kind: "draft", key: "d1", now: "2026-10-24T16:00:00Z" })).created, true);
    assert.equal((await reserveBudget(root, { kind: "draft", key: "d2", now: "2026-10-24T16:00:00Z" })).reserved, false);
    assert.equal(await releaseBudget(root, { kind: "role", key: "new-2", cohort: "new", day: "2026-10-23" }), true);
    assert.equal(await releaseBudget(root, { kind: "role", key: "new-1", cohort: "new", day: "2026-10-23" }), true);
    assert.equal(await releaseBudget(root, { kind: "role", key: "new-1", cohort: "new", day: "2026-10-23" }), false);
    assert.equal((await reserveBudget(root, { kind: "role", key: "new-after-preflight", cohort: "new", now })).reserved, true);
  } finally { cleanup(root); }
});

test("budget start markers survive crashes and only unstarted reservations can be released", async () => {
  const root = tempRoot();
  try {
    await writeConfig(root, { dailyRoles: 1, dailyDrafts: 1 });
    const now = "2026-10-23T16:00:00Z";
    const role = await reserveBudget(root, { kind: "role", key: "role-crash", cohort: "new", now });
    const draft = await reserveBudget(root, { kind: "draft", key: "draft-crash", now });
    assert.equal(role.reservation.startedAt, null);
    assert.equal(draft.reservation.startedAt, null);

    assert.equal(await markBudgetStarted(root, { kind: "role", key: "role-crash", day: role.day, now }), true);
    assert.equal(await releaseBudget(root, { kind: "role", key: "role-crash", cohort: "new", day: role.day }), false);
    assert.equal(await releaseBudget(root, { kind: "draft", key: "draft-crash", day: draft.day }), true, "the crash-before-launch draft reservation can be returned");

    const stored = readState(root).budgets[role.day];
    assert.equal(stored.roles["role-crash"].startedAt, new Date(now).toISOString(), "the launch marker is durable");
    assert.equal(await reserveBudget(root, { kind: "role", key: "role-retry", cohort: "new", now }).then(result => result.reserved), false, "started work keeps its allocation");
    assert.equal(await reserveBudget(root, { kind: "draft", key: "draft-after-release", now }).then(result => result.reserved), true);
  } finally { cleanup(root); }
});

test("a due role with a same-day reservation can continue when the total allocation is full", async () => {
  const root = tempRoot();
  try {
    await writeConfig(root, { dailyRoles: 1 });
    const now = "2026-10-23T16:00:00Z";
    const task = (await enqueueTask(root, { key: "role-already-reserved", type: "role_packet", cohort: "new", payload: {}, now })).task;
    await reserveBudget(root, { kind: "role", key: task.key, cohort: "new", now });
    assert.equal(await reserveBudget(root, { kind: "role", key: "would-exceed-cap", cohort: "backlog", now }).then(result => result.reserved), false);
    assert.equal(await chooseRoleCohort(root, { new: 1, backlog: 0 }, { now, reservedKeys: [task.key] }), "new");
  } finally { cleanup(root); }
});

test("claimTask prefers an already-reserved due task over earlier unreserved work", async () => {
  const root = tempRoot();
  try {
    await writeConfig(root, { dailyRoles: 1 });
    const now = "2026-10-23T16:00:00Z";
    await enqueueTask(root, { key: "unreserved-first", type: "role_packet", cohort: "new", payload: {}, now });
    const reserved = (await enqueueTask(root, { key: "reserved-second", type: "role_packet", cohort: "new", payload: {}, now })).task;
    await reserveBudget(root, { kind: "role", key: reserved.key, cohort: "new", now });
    const claimed = await claimTask(root, { types: ["role_packet"], cohort: "new", preferredKeys: [reserved.key], owner: "worker", now });
    assert.equal(claimed.id, reserved.id);
    assert.equal(readState(root).tasks.find(task => task.key === "unreserved-first").state, "queued");
  } finally { cleanup(root); }
});

test("reviews deduplicate and reject stale revisions", async () => {
  const root = tempRoot();
  try {
    const created = await addReview(root, { key: "mail:account:uid", type: "mail-match", title: "Confirm application", payload: { uid: "a1" } });
    const duplicate = await addReview(root, { key: "mail:account:uid", type: "mail-match", title: "ignored" });
    assert.equal(created.created, true);
    assert.equal(duplicate.created, false);
    const resolved = await resolveReview(root, created.review.id, 1, { accept: true });
    assert.equal(resolved.state, "resolved");
    assert.equal(resolved.revision, 2);
    await assert.rejects(resolveReview(root, created.review.id, 1, { accept: false }), (error) => error.status === 409 && error.current.revision === 2);
  } finally { cleanup(root); }
});

test("malformed config and state fail closed without replacing their bytes", async () => {
  const root = tempRoot();
  const configFile = path.join(root, "config", "automation.json");
  try {
    fs.mkdirSync(path.dirname(configFile), { recursive: true });
    fs.writeFileSync(configFile, '{"enabled":"yes"}\n');
    const oldConfig = fs.readFileSync(configFile, "utf8");
    assert.throws(() => readConfig(root), /enabled must be boolean/);
    await assert.rejects(writeConfig(root, { enabled: true }), /enabled must be boolean/);
    assert.equal(fs.readFileSync(configFile, "utf8"), oldConfig);
    fs.mkdirSync(path.dirname(statePath(root)), { recursive: true });
    fs.writeFileSync(statePath(root), '{"version":1,"tasks":"bad"}\n');
    const oldState = fs.readFileSync(statePath(root), "utf8");
    assert.throws(() => readState(root), /tasks must be an array/);
    await assert.rejects(withState(root, (state) => { state.digests.push({ id: 1 }); }), /tasks must be an array/);
    assert.equal(fs.readFileSync(statePath(root), "utf8"), oldState);
    fs.writeFileSync(statePath(root), '{"version":1,"tasks":[],"reviews":[],"budgets":{"broken":[]},"watches":{},"digests":[],"activation":null}\n');
    assert.throws(() => readState(root), /invalid budget bucket/);
  } finally { cleanup(root); }
});

test("data roots are isolated and attempt receipts are immutable", async () => {
  const first = tempRoot(); const second = tempRoot();
  try {
    await writeConfig(first, { enabled: true });
    assert.equal(readConfig(second).enabled, false);
    const { task } = await enqueueTask(first, { key: "attempt", type: "evaluate" });
    const running = await claimTask(first, { types: ["evaluate"], owner: "worker" });
    const receipt = writeAttempt(first, running, { outcome: "ok" });
    assert.equal(fs.statSync(receipt).mode & 0o777, 0o600);
    assert.throws(() => writeAttempt(first, running, { outcome: "changed" }), { code: "EEXIST" });
    assert.equal(JSON.parse(fs.readFileSync(receipt, "utf8")).outcome, "ok");
    assert.throws(() => writeAttempt(first, { id: "../../outside", attempts: 1 }, { outcome: "bad" }), /task id must be a UUID/);
    assert.equal(readState(second).tasks.length, 0);
    assert.ok(task.id);
  } finally { cleanup(first); cleanup(second); }
});
