import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { automationWorkerStatus } from "../../src/lib/automation-worker-status.mjs";

test("automation worker status remains disabled without creating setup files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-worker-status-"));
  try {
    assert.deepEqual(automationWorkerStatus(root), {
      enabled: false, state: "disabled", paused: false, at: null, active: null, lastError: null,
    });
    assert.deepEqual(fs.readdirSync(root), []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("automation worker status requires a fresh live heartbeat only when enabled", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-worker-status-enabled-"));
  const config = path.join(root, "config", "automation.json");
  const heartbeat = path.join(root, "data", "automation", "worker-heartbeat.json");
  const now = Date.now();
  try {
    fs.mkdirSync(path.dirname(config), { recursive: true });
    fs.mkdirSync(path.dirname(heartbeat), { recursive: true });
    fs.writeFileSync(config, JSON.stringify({ enabled: true }));
    assert.equal(automationWorkerStatus(root, { now }).state, "starting");
    fs.writeFileSync(heartbeat, JSON.stringify({ pid: 123, enabled: true, paused: true, at: new Date(now).toISOString(), active: { scan: false }, lastError: null }));
    const status = automationWorkerStatus(root, { now, isAlive: (pid) => pid === 123 });
    assert.equal(status.state, "paused");
    assert.deepEqual(status.active, { scan: false });
    assert.equal(automationWorkerStatus(root, { now: now + 181_000, isAlive: () => true }).state, "stale");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("invalid automation configuration is reported without being replaced", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-worker-status-invalid-"));
  const config = path.join(root, "config", "automation.json");
  try {
    fs.mkdirSync(path.dirname(config), { recursive: true });
    fs.writeFileSync(config, "{broken", "utf8");
    assert.equal(automationWorkerStatus(root).state, "invalid-config");
    assert.equal(fs.readFileSync(config, "utf8"), "{broken");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
