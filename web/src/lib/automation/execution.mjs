import fs from "node:fs";
import path from "node:path";
import { spawn as nodeSpawn } from "node:child_process";
import { findBin } from "../cli-binary.mjs";
import { parseCodexEvent } from "../run-cli-support.mjs";
import { spawnHeadlessCli } from "../spawn-cli.mjs";
import { CAPS } from "../worker-capabilities.mjs";

const CODEX_ISOLATION_FLAGS = Object.freeze([
  "--strict-config",
  "--ignore-user-config",
  "--ephemeral",
  "--skip-git-repo-check",
]);
const DEFAULT_TIMEOUT_MS = 780_000;
const MAX_OUTPUT_BYTES = 20 * 1024 * 1024;
const KILL_GRACE_MS = 5_000;
const resolveCodexBinary = () => {
  const binPath = findBin("codex");
  return binPath ? { binPath } : null;
};

function appendWithinByteLimit(addition, remainingBytes) {
  if (remainingBytes <= 0) return { value: "", bytes: 0, truncated: Boolean(addition) };
  const bytes = Buffer.from(addition);
  if (bytes.length <= remainingBytes) return { value: addition, bytes: bytes.length, truncated: false };
  return { value: bytes.subarray(0, remainingBytes).toString("utf8"), bytes: remainingBytes, truncated: true };
}

/**
 * Read mail secret variable names from the user-owned mail config. Values are
 * never read or returned; only their names are needed to remove them from an
 * AI child's environment.
 */
export function mailSecretNames(root, env = process.env) {
  const filename = env.CAREER_OPS_MAIL_CONFIG?.trim()
    ? path.resolve(root, env.CAREER_OPS_MAIL_CONFIG)
    : path.join(root, "config", "mail.json");
  try {
    const config = JSON.parse(fs.readFileSync(filename, "utf8"));
    const names = new Set();
    for (const account of Array.isArray(config.accounts) ? config.accounts : []) {
      for (const transport of [account?.imap, account?.smtp]) {
        if (typeof transport?.secretEnv === "string") names.add(transport.secretEnv);
      }
    }
    return names;
  } catch (error) {
    if (error?.code === "ENOENT") return new Set();
    // A malformed file may contain custom secretEnv names that cannot be
    // inferred from environment-variable naming. Refuse launch instead of
    // guessing which variables must be removed.
    throw new Error("Mail configuration is unreadable; repair the configured mail file before running background AI.");
  }
}

export function automationEnvironment(root, sourceEnv = process.env, { stripMailSecrets = false } = {}) {
  const env = { ...sourceEnv, CAREER_OPS_ROOT: root };
  if (stripMailSecrets) {
    for (const name of mailSecretNames(root, sourceEnv)) delete env[name];
    // Preserve the Codex login but do not expose an environment-selected mail
    // configuration path to a model process.
    delete env.CAREER_OPS_MAIL_CONFIG;
  }
  return env;
}

/**
 * Shared process boundary used by /api/run and durable automation workers.
 * Fencing is required and stdin is closed by spawnHeadlessCli.
 */
export function spawnAutomationCli(binPath, args, options, { cliId, capabilities, spawnFn = spawnHeadlessCli }) {
  return spawnFn(binPath, args, options, { cliId, capabilities });
}

/** Check local Codex authentication without starting a model or exposing its output. */
export async function checkCodexLogin({ resolveCliFn = (id) => id === "codex" ? resolveCodexBinary() : null, spawnFn = nodeSpawn, env = process.env } = {}) {
  const resolved = resolveCliFn("codex");
  if (!resolved) return { ok: false, reason: "Codex CLI is unavailable in this instance." };
  return new Promise((resolve) => {
    let child;
    try {
      child = spawnFn(resolved.binPath, ["login", "status"], {
        cwd: process.cwd(), env: { ...env }, stdio: ["ignore", "pipe", "pipe"], windowsHide: true,
      });
    } catch {
      resolve({ ok: false, reason: "Could not start Codex login status check." });
      return;
    }
    let output = "";
    const timer = setTimeout(() => { try { child.kill("SIGTERM"); } catch { /* already exited */ } }, 10_000);
    timer.unref?.();
    child.stdout?.on("data", (chunk) => { output += String(chunk); });
    child.stderr?.on("data", (chunk) => { output += String(chunk); });
    child.once("error", () => {
      clearTimeout(timer);
      resolve({ ok: false, reason: "Could not start Codex login status check." });
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      const authenticated = code === 0 && !/not logged in|not authenticated|login required/i.test(output);
      resolve(authenticated
        ? { ok: true }
        : { ok: false, reason: "Codex is not authenticated in this instance." });
    });
  });
}

/**
 * Run the instance's authenticated Codex CLI with the shared capability fence.
 * The isolated config prevents interactive MCP servers from entering a
 * background workflow. Model and reasoning overrides are optional; absent
 * values leave Codex's installed CLI default in control.
 *
 * @param {string} root User data root
 * @param {string} prompt
 * @param {{capabilities?: import("../worker-capabilities.mjs").Capabilities,config?: {cliId?: string,model?: string,reasoningEffort?: string,timeoutMs?: number},signal?: AbortSignal,onEvent?: (event: object)=>void,env?: NodeJS.ProcessEnv,resolveCliFn?: typeof resolveCli,spawnFn?: typeof spawnHeadlessCli}} options
 */
export async function runAutomationCodex(root, prompt, options = {}) {
  const startedAt = Date.now();
  const config = options.config ?? {};
  const cliId = config.cliId ?? "codex";
  if (cliId !== "codex") throw new Error("Background automation requires the configured Codex CLI.");
  if (typeof prompt !== "string" || !prompt.trim()) throw new TypeError("A non-empty prompt is required.");
  if (options.signal?.aborted) {
    return { stdout: "", stderr: "", text: "", exitCode: null, timedOut: false, cancelled: true, cliId, durationMs: Date.now() - startedAt };
  }
  const resolveCodex = options.resolveCliFn ?? ((id) => id === "codex" ? resolveCodexBinary() : null);
  const resolved = resolveCodex("codex");
  if (!resolved) throw new Error("Codex CLI is unavailable in this instance.");
  const { binPath } = resolved;
  const capabilities = options.capabilities ?? CAPS.localReadOnly;
  const args = ["exec", ...CODEX_ISOLATION_FLAGS, "--json", "--color", "never"];
  if (config.model) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/@+-]{0,199}$/.test(config.model)) throw new Error("Invalid Codex model setting.");
    args.push("--model", config.model);
  }
  const effort = config.effort ?? config.reasoningEffort;
  if (effort) {
    if (!/^(?:none|minimal|low|medium|high|xhigh|max|ultra)$/.test(effort)) throw new Error("Invalid Codex reasoning effort.");
    args.push("-c", `model_reasoning_effort=${JSON.stringify(effort)}`);
  }
  // codex exec consumes its positional prompt last. This is also the marker
  // used by cli-fencing.mjs to protect its own policy flags.
  args.push(prompt);

  const env = automationEnvironment(root, options.env ?? process.env, { stripMailSecrets: true });
  await options.beforeAiStart?.(options.stage);
  const child = spawnAutomationCli(
    binPath,
    args,
    {
      cwd: root,
      env,
      signal: undefined,
    },
    { cliId, capabilities, spawnFn: options.spawnFn },
  );
  return await new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let text = "";
    let buffer = "";
    let settled = false;
    let timedOut = false;
    let outputLimitExceeded = false;
    let outputBytes = 0;
    let forceKill;
    const timeoutMs = Number.isFinite(config.timeoutMs) && config.timeoutMs > 0 ? config.timeoutMs : DEFAULT_TIMEOUT_MS;
    const timer = setTimeout(() => {
      timedOut = true;
      terminate();
    }, timeoutMs);
    timer.unref?.();
    function terminate() {
      try { child.kill("SIGTERM"); } catch { /* process already exited */ }
      if (!forceKill) {
        forceKill = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* */ } }, options.killGraceMs ?? KILL_GRACE_MS);
        forceKill.unref?.();
      }
    }
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceKill) clearTimeout(forceKill);
      options.signal?.removeEventListener("abort", abort);
      resolve({ ...result, stdout, stderr, text, timedOut, cancelled: options.signal?.aborted ?? false, outputLimitExceeded, cliId, durationMs: Date.now() - startedAt });
    };
    const abort = () => terminate();
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    child.stdout.setEncoding?.("utf8");
    child.stderr.setEncoding?.("utf8");
    child.stdout.on("data", (chunk) => {
      if (settled || outputLimitExceeded) return;
      const value = String(chunk);
      const accepted = appendWithinByteLimit(value, MAX_OUTPUT_BYTES - outputBytes);
      stdout += accepted.value;
      outputBytes += accepted.bytes;
      buffer += accepted.value;
      if (accepted.truncated) {
        outputLimitExceeded = true;
        terminate();
      }
      let newline;
      while ((newline = buffer.indexOf("\n")) >= 0) {
        consumeLine(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
    });
    child.stderr.on("data", (chunk) => {
      if (settled || outputLimitExceeded) return;
      const accepted = appendWithinByteLimit(String(chunk), MAX_OUTPUT_BYTES - outputBytes);
      stderr += accepted.value;
      outputBytes += accepted.bytes;
      if (accepted.truncated) {
        outputLimitExceeded = true;
        terminate();
      }
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (forceKill) clearTimeout(forceKill);
      options.signal?.removeEventListener("abort", abort);
      reject(error);
    });
    child.once("close", (code) => {
      if (buffer.trim()) consumeLine(buffer);
      finish({ exitCode: code });
    });
    function consumeLine(line) {
      const event = parseCodexEvent(line.trim());
      if (!event) return;
      if (typeof event.text === "string") {
        text += appendWithinByteLimit(event.text, MAX_OUTPUT_BYTES - Buffer.byteLength(text)).value;
      }
      options.onEvent?.(event);
    }
  });
}
