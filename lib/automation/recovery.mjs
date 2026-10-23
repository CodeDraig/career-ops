import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const CODE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUTER_RETRY_DELAYS_MS = [5 * 60_000, 30 * 60_000];
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function stableSourceId({ scanner, name, provider, scope }) {
  return hash({ scanner, name: String(name || '').trim().toLowerCase(), provider, scope });
}

export function sourceConfigScope(entry) {
  const config = Object.fromEntries(Object.entries(entry ?? {}).filter(([key]) => !key.startsWith('_')));
  return { entrySha256: hash(config) };
}

export function makeRunReceipt({ scanner, config, startedAt, finishedAt, targets, scope = {}, baseConfigSha256 }) {
  return {
    schema: 'career-ops.scan-run@1', scanner, runId: randomUUID(), startedAt, finishedAt,
    configSha256: hash(config ?? {}), baseConfigSha256: baseConfigSha256 || hash(config ?? {}), scope,
    targets: targets.map(target => ({
      sourceId: target.sourceId || stableSourceId({ scanner, name: target.name, provider: target.provider, scope: target.scope || scope }),
      name: target.name,
      provider: target.provider || null,
      configScope: target.configScope || scope,
      status: target.status,
      complete: target.complete === true,
      jobs: Number.isFinite(target.jobs) ? target.jobs : 0,
      addedUrls: [...new Set(target.addedUrls || [])],
      warnings: target.warnings || [],
      error: target.error || null,
      kind: target.kind || null,
      statusCode: target.statusCode || null,
      retryAfter: target.retryAfter || null,
    })),
  };
}

function retryAfterMs(value, now) {
  if (typeof value === 'number' && Number.isFinite(value)) return now + Math.max(0, value * 1000);
  if (typeof value !== 'string' || !value.trim()) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return now + Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(now, date) : null;
}

function recoverable(target) {
  if (target.complete === true && target.status !== 'error' && target.status !== 'incomplete') return false;
  if (!['error', 'incomplete'].includes(target.status)) return false;
  const kind = String(target.kind || '').toLowerCase();
  if (['auth', 'authentication', 'challenge', 'unsupported', 'structural', 'configuration', 'slug_gone'].includes(kind)) return false;
  if (/(captcha|challenge|verify you are human|sign[ -]?in required|login required)/i.test(String(target.error || ''))) return false;
  if (target.status === 'empty' && target.complete === true) return false;
  return Boolean(target.error || target.status === 'error' || target.status === 'incomplete' || target.complete === false);
}

/** Convert detailed scanner outcomes into stable, bounded source recovery tasks. */
export function recoveryTasks(receipt, { now = Date.now() } = {}) {
  if (!receipt || receipt.schema !== 'career-ops.scan-run@1' || !Array.isArray(receipt.targets)) return [];
  const nowMs = now instanceof Date ? now.getTime() : Number(now);
  return receipt.targets.filter(recoverable).map(target => {
    const attempt = Number.isInteger(target.outerAttempt) ? target.outerAttempt : 0;
    const key = hash({ run: receipt.runId || receipt.startedAt, config: receipt.configSha256,
      scanner: receipt.scanner, sourceId: target.sourceId });
    const retryAtFromServer = retryAfterMs(target.retryAfter, nowMs);
    const retryAt = attempt < OUTER_RETRY_DELAYS_MS.length
      ? Math.max(nowMs + OUTER_RETRY_DELAYS_MS[attempt], retryAtFromServer || 0)
      : null;
    return {
      key,
      type: 'source_recovery',
      payload: {
        scanner: receipt.scanner,
        sourceId: target.sourceId,
        name: target.name,
        provider: target.provider,
        configScope: target.configScope,
        configSha256: receipt.configSha256,
        baseConfigSha256: receipt.baseConfigSha256 || null,
        configPath: receipt.scope?.effectiveConfigPath || null,
        originalReceiptStartedAt: receipt.startedAt,
        runArgs: receipt.scope?.runArgs || [],
        originalStatus: target.status,
        originalError: target.error,
        outerAttempt: attempt,
      },
      retryAt: retryAt === null ? null : new Date(retryAt).toISOString(),
      exhausted: retryAt === null,
      requiresReview: retryAt === null,
    };
  });
}

function runScanner(args, { root, signal, env = process.env, timeoutMs = 27 * 60_000 } = {}) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, args, {
      cwd: CODE_ROOT,
      env: { ...env, CAREER_OPS_ROOT: root, CAREER_OPS_DATA_DIR: root },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const maxOutput = 256 * 1024;
    let stdout = '', stderr = '', timedOut = false;
    child.stdout.setEncoding('utf8').on('data', chunk => { if (stdout.length < maxOutput) stdout += chunk.slice(0, maxOutput - stdout.length); });
    child.stderr.setEncoding('utf8').on('data', chunk => { if (stderr.length < maxOutput) stderr += chunk.slice(0, maxOutput - stderr.length); });
    const abort = () => child.kill('SIGTERM');
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGTERM'); }, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    let settled = false;
    child.on('error', error => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      resolve({ code: 1, stdout, stderr, error: error.message });
    });
    child.on('close', (code, sig) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      resolve({ code: code ?? 1, signal: sig, stdout, stderr, timedOut,
        stdoutTruncated: stdout.length >= maxOutput, stderrTruncated: stderr.length >= maxOutput });
    });
  });
}

/** Retry exactly one configured source; the scanner re-applies its normal filters and canonical writers. */
export async function executeRecovery(root, task, { config, configPath, signal, env = process.env, runScannerFn = runScanner } = {}) {
  const payload = task?.payload || {};
  const yaml = await import('js-yaml');
  const effectivePath = configPath || payload.configPath || null;
  const effectiveConfig = effectivePath ? yaml.load(readFileSync(effectivePath, 'utf8')) : config;
  const currentConfigSha256 = hash(effectiveConfig);
  if (!payload.sourceId || !['portals', 'ats-full'].includes(payload.scanner)) {
    return { state: 'blocked', reason: 'unsupported_recovery_scope' };
  }
  if (!payload.configSha256 || currentConfigSha256 !== payload.configSha256) {
    return { state: 'needs_review', reason: 'effective_source_configuration_changed_or_missing' };
  }
  if (!payload.baseConfigSha256) {
    return { state: 'needs_review', reason: 'base_source_configuration_fingerprint_missing' };
  }
  const currentBaseSha256 = hash(await (async () => {
    const file = env.CAREER_OPS_BASE_PORTALS || env.CAREER_OPS_PORTALS || path.join(root, 'portals.yml');
    return yaml.load(readFileSync(file, 'utf8'));
  })());
  if (currentBaseSha256 !== payload.baseConfigSha256) {
    return { state: 'needs_review', reason: 'base_source_configuration_changed' };
  }
  const outerAttempt = Number(payload.outerAttempt ?? task?.attempts ?? 0);
  if (outerAttempt >= OUTER_RETRY_DELAYS_MS.length) {
    return { state: 'needs_review', reason: 'recovery_attempts_exhausted' };
  }
  const attemptId = `${String(outerAttempt + 1).padStart(2, '0')}-${randomUUID()}`;
  const receiptFile = path.join(root, 'data/automation/receipts', `${task.key || randomUUID()}-${attemptId}.json`);
  const runArgs = [...(Array.isArray(payload.runArgs) ? payload.runArgs : [])];
  let tempConfigPath = null;
  let resolvedConfigPath = effectivePath;
  if (!resolvedConfigPath) {
    tempConfigPath = path.join(root, 'data/automation/tmp', `recovery-config-${attemptId}.yml`);
    mkdirSync(path.dirname(tempConfigPath), { recursive: true });
    writeFileSync(tempConfigPath, yaml.dump(effectiveConfig), { mode: 0o600, flag: 'wx' });
    resolvedConfigPath = tempConfigPath;
  }
  const args = payload.scanner === 'portals'
    ? [path.join(CODE_ROOT, 'scan.mjs'), ...runArgs, '--target-id', payload.sourceId, '--run-receipt', receiptFile, '--quiet']
    : [path.join(CODE_ROOT, 'scan-ats-full.mjs'), ...runArgs, '--target-source-id', payload.sourceId, '--run-receipt', receiptFile, '--json'];
  const processResult = await runScannerFn(args, { root, signal, env: { ...env,
    CAREER_OPS_PORTALS: resolvedConfigPath,
    CAREER_OPS_EFFECTIVE_PORTALS_SNAPSHOT: resolvedConfigPath,
    CAREER_OPS_BASE_PORTALS: env.CAREER_OPS_BASE_PORTALS || env.CAREER_OPS_PORTALS || path.join(root, 'portals.yml'),
    CAREER_OPS_BASE_PORTALS_SHA256: payload.baseConfigSha256 } });
  if (tempConfigPath) {
    try { await import('node:fs/promises').then(fs => fs.unlink(tempConfigPath)); } catch { /* preserve result if temp cleanup fails */ }
  }
  let receipt = null;
  try { receipt = JSON.parse(readFileSync(receiptFile, 'utf8')); } catch { /* child failure is returned below */ }
  const outcome = receipt?.targets?.find(target => target.sourceId === payload.sourceId);
  if (outcome?.complete === true && !['error', 'incomplete'].includes(outcome.status)) {
    return { state: 'completed', result: { receipt, target: outcome } };
  }
  const nextTask = outcome ? recoveryTasks({ ...receipt, targets: [{ ...outcome, outerAttempt: outerAttempt + 1 }] })[0] : null;
  if (nextTask?.retryAt) return { state: 'waiting_retry', retryAt: nextTask.retryAt,
    nextPayload: nextTask.payload, result: { receipt, process: processResult } };
  return { state: 'needs_review', reason: outcome?.kind || processResult.error || 'source_recovery_incomplete', result: { receipt, process: processResult } };
}

export const recoveryPolicy = Object.freeze({
  outerRetryDelaysMs: OUTER_RETRY_DELAYS_MS,
  maxOuterRetries: OUTER_RETRY_DELAYS_MS.length,
});
