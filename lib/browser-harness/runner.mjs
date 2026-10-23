import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { withPipelineLock, LockTimeoutError } from '../../pipeline-lock.mjs';
import { extractIndeedPage } from './indeed-extract.mjs';

const codeRoot = fileURLToPath(new URL('../../', import.meta.url));

export function browserHarnessLockPath() {
  return path.join(os.tmpdir(), `career-ops-browser-harness-${process.getuid?.() ?? os.userInfo().username}`);
}

export function browserHarnessBinary(env = process.env) {
  if (env.CAREER_OPS_BROWSER_HARNESS_BIN) return env.CAREER_OPS_BROWSER_HARNESS_BIN;
  const checkout = env.CAREER_OPS_BROWSER_HARNESS_ROOT || path.join(codeRoot, '..', 'browser-harness');
  const bin = path.join(checkout, '.venv', process.platform === 'win32' ? 'Scripts/browser-harness.exe' : 'bin/browser-harness');
  return existsSync(bin) ? bin : 'browser-harness';
}

export function browserHarnessProgram(url) {
  const payload = Buffer.from(JSON.stringify({ url, expression: `(${extractIndeedPage.toString()})()` })).toString('base64');
  return `import base64, json\nrequest = json.loads(base64.b64decode('${payload}'))\n` + readFileSync(new URL('./indeed.py', import.meta.url), 'utf8');
}

/** Only fixed browser code is sent on stdin. Request text never becomes code. */
export async function readIndeed(url, { env = process.env, execute = execFile } = {}) {
  try {
    return await withPipelineLock(browserHarnessLockPath(), () => run(url, env, execute), { timeoutMs: 1000 });
  } catch (error) { return { status: error instanceof LockTimeoutError ? 'busy' : 'browser_unavailable' }; }
}

export async function readLivenessInBrowser(url, { env = process.env, execute = execFile } = {}) {
  try {
    return await withPipelineLock(browserHarnessLockPath(), async () => {
      const raw = await runLiveness(url, env, execute);
      if (raw?.status !== 'page') return { result: 'uncertain', code: raw?.status || 'browser_unavailable', reason: raw?.reason || 'Browser Harness extension could not inspect the posting.' };
      const { classifyLiveness } = await import('../../liveness-core.mjs');
      const verdict = classifyLiveness({
        status: 200,
        requestedUrl: url,
        finalUrl: raw.url,
        bodyText: `${raw.title || ''}\n${raw.text || ''}`,
        applyControls: raw.controls || [],
      });
      if (verdict.result !== 'uncertain' && raw.targetId) await closeLivenessTab(raw.targetId, raw.url, env, execute);
      return verdict;
    }, { timeoutMs: 1000 });
  } catch (error) {
    return { result: 'uncertain', code: error instanceof LockTimeoutError ? 'browser_busy' : 'browser_unavailable', reason: error instanceof LockTimeoutError ? 'The Browser Harness tab is busy; retry after the current browser task.' : 'Browser Harness extension could not inspect the posting.' };
  }
}

function run(url, env, execute) {
  return new Promise(resolve => {
    const child = execute(browserHarnessBinary(env), [], {
      cwd: codeRoot, env: { ...env, BH_BACKEND: 'extension', BU_NAME: env.CAREER_OPS_BROWSER_HARNESS_SESSION || 'career-ops', BH_DOMAIN_SKILLS: '0', BH_RECORD: '0' },
      timeout: 90000, maxBuffer: 2 * 1024 * 1024,
    }, (error, stdout) => {
      const line = String(stdout || '').split(/\r?\n/).find(line => line.startsWith('CAREER_OPS_INDEED='));
      if (line) {
        try { resolve(JSON.parse(line.slice('CAREER_OPS_INDEED='.length))); return; } catch { /* explicit failure below */ }
      }
      // Raw harness logs can contain local paths or session details; don't return them to the web.
      resolve({ status: error?.code === 'ENOENT' ? 'not_configured' : 'browser_unavailable' });
    });
    child.stdin?.on('error', () => {});
    child.stdin?.end(browserHarnessProgram(url));
  });
}

function livenessProgram(url) {
  const payload = Buffer.from(JSON.stringify({ url })).toString('base64');
  return `import base64, json, time\nrequest = json.loads(base64.b64decode('${payload}'))\n` + readFileSync(new URL('./liveness.py', import.meta.url), 'utf8');
}

function runLiveness(url, env, execute) {
  return new Promise(resolve => {
    const child = execute(browserHarnessBinary(env), [], {
      cwd: codeRoot, env: { ...env, BH_BACKEND: 'extension', BU_NAME: env.CAREER_OPS_BROWSER_HARNESS_SESSION || 'career-ops', BH_DOMAIN_SKILLS: '0', BH_RECORD: '0' },
      timeout: 90000, maxBuffer: 2 * 1024 * 1024,
    }, (error, stdout) => {
      const line = String(stdout || '').split(/\r?\n/).find(item => item.startsWith('CAREER_OPS_LIVENESS='));
      if (line) {
        try { resolve(JSON.parse(line.slice('CAREER_OPS_LIVENESS='.length))); return; } catch { /* report an uncertain result below */ }
      }
      resolve({ status: error?.code === 'ENOENT' ? 'not_configured' : 'browser_unavailable' });
    });
    child.stdin?.on('error', () => {});
    child.stdin?.end(livenessProgram(url));
  });
}

function closeLivenessTab(targetId, expectedUrl, env, execute) {
  const payload = Buffer.from(JSON.stringify({ targetId, expectedUrl })).toString('base64');
  const source = `import base64, json\nrequest = json.loads(base64.b64decode('${payload}'))\n` +
    "try:\n current = current_tab()\n if current.get('targetId') == request['targetId'] and current.get('url') == request['expectedUrl']:\n  close_tab(request['targetId'])\nexcept Exception:\n pass\n";
  return new Promise(resolve => {
    const child = execute(browserHarnessBinary(env), [], {
      cwd: codeRoot, env: { ...env, BH_BACKEND: 'extension', BU_NAME: env.CAREER_OPS_BROWSER_HARNESS_SESSION || 'career-ops', BH_DOMAIN_SKILLS: '0', BH_RECORD: '0' },
      timeout: 15000, maxBuffer: 256 * 1024,
    }, () => resolve());
    child.stdin?.on('error', () => {});
    child.stdin?.end(source);
  });
}
