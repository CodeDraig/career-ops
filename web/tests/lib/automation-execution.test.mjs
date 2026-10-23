import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { findBin } from "../../src/lib/cli-binary.mjs";
import { checkCodexLogin, runAutomationCodex } from "../../src/lib/automation/execution.mjs";

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.kill = () => {};
  return child;
}

test("Codex worker uses isolated, fenced read-only launch and strips configured mail secrets", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-automation-exec-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "config"), { recursive: true });
  fs.writeFileSync(path.join(root, "config", "mail.json"), JSON.stringify({ accounts: [{ imap: { secretEnv: "PRIVATE_IMAP_PASSWORD" }, smtp: { secretEnv: "PRIVATE_SMTP_TOKEN" } }] }));
  const env = { PRIVATE_IMAP_PASSWORD: "secret-imap", PRIVATE_SMTP_TOKEN: "secret-smtp", CODEX_HOME: "/instance/codex", CAREER_OPS_MAIL_CONFIG: "config/mail.json" };
  let captured;
  const spawnFn = (binPath, args, options, fencing) => {
    captured = { binPath, args, options, fencing };
    const child = fakeChild();
    setImmediate(() => {
      child.stdout.write(`${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Draft is ready." } })}\n`);
      child.stdout.end();
      child.stderr.end();
      child.emit("close", 0);
    });
    return child;
  };
  const events = [];
  const result = await runAutomationCodex(root, "Read the supplied job data.", {
    env,
    config: { model: "gpt-6.1-sol", effort: "low" },
    resolveCliFn: () => ({ spec: {}, binPath: "/usr/bin/codex" }),
    spawnFn,
    onEvent: (event) => events.push(event),
  });
  assert.equal(captured.binPath, "/usr/bin/codex");
  assert.equal(captured.options.cwd, root);
  assert.equal(captured.options.env.CAREER_OPS_ROOT, root);
  assert.equal(captured.options.env.CODEX_HOME, "/instance/codex");
  assert.equal("PRIVATE_IMAP_PASSWORD" in captured.options.env, false);
  assert.equal("PRIVATE_SMTP_TOKEN" in captured.options.env, false);
  assert.equal("CAREER_OPS_MAIL_CONFIG" in captured.options.env, false);
  assert.deepEqual(captured.fencing.capabilities, { writes: false, network: false });
  assert.ok(captured.args.includes("--ignore-user-config"));
  assert.ok(captured.args.includes("--ephemeral"));
  assert.ok(captured.args.includes("gpt-6.1-sol"));
  assert.ok(captured.args.includes('model_reasoning_effort="low"'));
  assert.equal(captured.args.at(-1), "Read the supplied job data.");
  assert.match(result.text, /Draft is ready/);
  assert.equal(result.exitCode, 0);
  assert.equal(events.length, 1);
});

test("Codex launch awaits beforeAiStart immediately before the child spawn", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-automation-hook-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "config"), { recursive: true });
  fs.writeFileSync(path.join(root, "config", "mail.json"), "{}");
  const order = [];
  const result = await runAutomationCodex(root, "Read supplied data.", {
    env: {},
    config: {},
    stage: "draft",
    beforeAiStart: async (stage) => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      order.push(`hook:${stage}`);
    },
    resolveCliFn: () => ({ binPath: "/usr/bin/codex" }),
    spawnFn: () => {
      order.push("spawn");
      const child = fakeChild();
      setImmediate(() => {
        child.stdout.end(`${JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "ok" } })}\n`);
        child.stderr.end();
        child.emit("close", 0);
      });
      return child;
    },
  });
  assert.equal(result.exitCode, 0);
  assert.deepEqual(order, ["hook:draft", "spawn"]);
});

test("Codex login probe reports readiness without exposing CLI output", async () => {
  const result = await checkCodexLogin({
    env: { CODEX_HOME: "/instance/codex" },
    resolveCliFn: () => ({ binPath: "/usr/bin/codex" }),
    spawnFn: (binPath, args, options) => {
      assert.equal(binPath, "/usr/bin/codex");
      assert.deepEqual(args, ["login", "status"]);
      assert.equal(options.env.CODEX_HOME, "/instance/codex");
      const child = fakeChild();
      setImmediate(() => {
        child.stdout.end("Logged in as private@example.test\n");
        child.stderr.end();
        child.emit("close", 0);
      });
      return child;
    },
  });
  assert.deepEqual(result, { ok: true });
});

test("shared executable resolver finds a CLI binary using the catalog resolver", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-cli-bin-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const binary = path.join(root, "codex");
  fs.writeFileSync(binary, "#!/bin/sh\nexit 0\n");
  fs.chmodSync(binary, 0o755);
  assert.equal(findBin("codex", [root]), binary);
});

test("malformed mail config refuses the AI launch without exposing its contents", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-automation-mail-config-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, "config"), { recursive: true });
  fs.writeFileSync(path.join(root, "config", "mail.json"), '{"secretEnv":"CUSTOM_PRIVATE_TOKEN"');
  let spawned = false;
  await assert.rejects(runAutomationCodex(root, "Prepare a draft.", {
    env: { CUSTOM_PRIVATE_TOKEN: "never expose", CAREER_OPS_MAIL_CONFIG: "config/mail.json" },
    resolveCliFn: () => ({ binPath: "/usr/bin/codex" }),
    spawnFn: () => { spawned = true; return fakeChild(); },
  }), (error) => {
    assert.match(error.message, /Mail configuration is unreadable/);
    assert.doesNotMatch(error.message, /CUSTOM_PRIVATE_TOKEN|never expose|secretEnv/);
    return true;
  });
  assert.equal(spawned, false);
});

test("AI stdout and stderr share a 20 MiB cap and process termination escalates after abort", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-automation-output-"));
  const killed = [];
  const controller = new AbortController();
  const resultPromise = runAutomationCodex(root, "Read the supplied data.", {
    signal: controller.signal,
    killGraceMs: 100,
    resolveCliFn: () => ({ binPath: "/usr/bin/codex" }),
    spawnFn: () => {
      const child = fakeChild();
      child.kill = (signal) => killed.push(signal);
      setImmediate(() => {
        child.stdout.write("x".repeat(12 * 1024 * 1024));
        child.stderr.write("y".repeat(9 * 1024 * 1024));
        controller.abort();
        setTimeout(() => child.emit("close", null), 20);
      });
      return child;
    },
  });
  const result = await resultPromise;
  assert.equal(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr), 20 * 1024 * 1024);
  assert.equal(result.outputLimitExceeded, true);
  assert.deepEqual(killed, ["SIGTERM", "SIGTERM"]);
});

test("abort escalates a still-running Codex process to SIGKILL", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "career-ops-automation-abort-"));
  const controller = new AbortController();
  const killed = [];
  const resultPromise = runAutomationCodex(root, "Read the supplied data.", {
    signal: controller.signal,
    killGraceMs: 10,
    resolveCliFn: () => ({ binPath: "/usr/bin/codex" }),
    spawnFn: () => {
      const child = fakeChild();
      child.kill = (signal) => killed.push(signal);
      setImmediate(() => controller.abort());
      setTimeout(() => child.emit("close", null), 30);
      return child;
    },
  });
  await resultPromise;
  assert.deepEqual(killed, ["SIGTERM", "SIGKILL"]);
});
