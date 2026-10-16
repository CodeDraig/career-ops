import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { withPipelineLock, LockTimeoutError } from '../../pipeline-lock.mjs';
import { extractIndeedPage } from './indeed-extract.mjs';

const codeRoot = fileURLToPath(new URL('../../', import.meta.url));

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
  // All Career-Ops processes sharing this OS account serialize selected-tab use.
  const lock = path.join(os.tmpdir(), `career-ops-indeed-${process.getuid?.() ?? os.userInfo().username}`);
  try {
    return await withPipelineLock(lock, () => run(url, env, execute), { timeoutMs: 1000 });
  } catch (error) { return { status: error instanceof LockTimeoutError ? 'busy' : 'browser_unavailable' }; }
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
