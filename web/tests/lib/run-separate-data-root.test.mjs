import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { register } from 'node:module';
import '../helpers/web-ts-alias-loader.mjs';

const CORE = fileURLToPath(new URL('../../../', import.meta.url));
const worker = fileURLToPath(new URL('../fixtures/run-data-root-worker.mjs', import.meta.url));
const mocks = {
  '@/lib/clis': `
    export const resolveCliOrFallback = () => ({ spec: { id: "claude", name: "Fixture Claude" }, binPath: "fixture" });
    export const cliSubstitutionNotice = () => null;
    export const cliUnavailableError = () => ({ error: "fixture unavailable" });
  `,
  '@/lib/spawn-cli.mjs': `
    import { spawn } from "node:child_process";
    export function spawnHeadlessCli(bin, args, opts) {
      return spawn(process.execPath, [${JSON.stringify(worker)}, args[args.indexOf("-p") + 1]], { ...opts, stdio: ["ignore", "pipe", "pipe"] });
    }
  `,
};
register(`data:text/javascript,${encodeURIComponent(`
  const mocks = ${JSON.stringify(mocks)};
  export async function resolve(specifier, context, nextResolve) {
    if (mocks[specifier]) return { url: "data:text/javascript," + encodeURIComponent(mocks[specifier]), shortCircuit: true };
    return nextResolve(specifier, context);
  }
`)}`, import.meta.url);

const { POST: run } = await import('../../src/app/api/run/route.ts');
const { readApplications, readLanguageConfig, pdfPathForReport } = await import('../../src/lib/career-ops.ts');
let skipCore = false;
try {
  await import('../../../tracker-utils.mjs');
} catch (error) {
  if (error.code !== 'ERR_MODULE_NOT_FOUND' || fs.existsSync(path.join(CORE, 'node_modules'))) throw error;
  skipCore = 'core dependencies are not installed (web-only checkout)';
}

function fixture(t) {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'co-run-separate-'));
  const keys = ['CAREER_OPS_ROOT', 'CAREER_OPS_CODE_ROOT', 'CAREER_OPS_TRACKER', 'CAREER_OPS_ADDITIONS', 'CAREER_OPS_PROFILE', 'CAREER_OPS_PDF_INDEX'];
  const prev = { ...process.env };
  for (const k of keys) delete process.env[k];
  process.env.CAREER_OPS_ROOT = data;
  process.env.CAREER_OPS_CODE_ROOT = CORE;
  fs.mkdirSync(path.join(data, 'config'));
  fs.writeFileSync(path.join(data, 'cv.md'), '# Fictional Fixture\n\nFixture engineer.\n');
  fs.writeFileSync(path.join(data, 'config/profile.yml'), 'candidate:\n  full_name: Fictional Fixture\nlanguage:\n  output: en\n  modes_dir: modes/fr\n');
  fs.writeFileSync(path.join(data, 'config/cv-facts.json'), '{}\n');
  fs.mkdirSync(path.join(data, 'data'));
  fs.writeFileSync(path.join(data, 'data/applications.md'), '# Fixture tracker\n\n| # | Date | Company | Role | Score | Status | PDF | Report | Notes |\n|---|---|---|---|---|---|---|---|---|\n');
  t.after(() => {
    for (const k of keys) if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k];
    fs.rmSync(data, { recursive: true, force: true });
  });
  return data;
}

async function invoke(kind, input) {
  const response = await run(new Request('http://fixture.invalid/api/run', {
    method: 'POST', body: JSON.stringify({ kind, input, cliId: 'claude' }),
  }));
  assert.equal(response.status, 200, await response.clone().text());
  const events = (await response.text()).trim().split('\n').map(JSON.parse);
  assert.deepEqual(events.filter((e) => e.type === 'error'), [], JSON.stringify(events));
  return events;
}

test('separate data root: evaluation reads the configured market and persists through core commands', { skip: skipCore }, async (t) => {
  const data = fixture(t);
  assert.equal(readLanguageConfig().modesDir, 'modes/fr');
  assert.match(readLanguageConfig().evalModeFile, /^modes\/fr\//);
  await invoke('evaluate', 'https://fixture.invalid/jobs/1');
  const apps = readApplications();
  assert.equal(apps.length, 1, fs.readFileSync(path.join(data, 'merge-result.txt'), 'utf8'));
  assert.equal(apps[0].company, 'Fictional Fixture');
  assert.equal(apps[0].status, 'Evaluated');
  assert.ok(fs.readdirSync(path.join(data, 'reports')).some((f) => f.includes('-fictional-fixture-')));
});

test('separate data root: PDF run renders an actual PDF and marks the same tracker', {
  skip: skipCore || process.env.CAREER_OPS_BROWSER_TESTS !== '1', timeout: 60_000,
}, async (t) => {
  const data = fixture(t);
  await invoke('evaluate', 'https://fixture.invalid/jobs/1');
  const n = readApplications()[0].report.match(/\[(\d+)\]/)[1];
  await invoke('pdf', n);
  const pdf = await pdfPathForReport(n);
  assert.ok(pdf?.startsWith(path.join(data, 'output') + path.sep));
  assert.equal(fs.readFileSync(pdf).subarray(0, 5).toString(), '%PDF-');
  assert.match(readApplications()[0].pdf, /✅/);
  assert.deepEqual(fs.readdirSync(path.join(data, '.career-ops-web/pdf-tmp')), []);
});
