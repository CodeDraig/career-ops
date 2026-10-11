import { mkdtempSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { pass, fail, ROOT, NODE, rmSync } from './helpers.mjs';
import { outputLanguageInstruction, parseOutputLanguage } from '../profile-language.mjs';
function check(ok, message) { if (ok) pass(message); else fail(message); }
for (const profile of ['', 'language: [invalid', 'language:\n  output: de\n', 'language:\n  output: ja\n  modes_dir: [modes/de, modes/zh]']) {
  check(parseOutputLanguage(profile) === 'en', 'legacy output settings always resolve to English');
}
check(outputLanguageInstruction('fr').includes('Write all human-facing output in English'), 'legacy arguments cannot override English output');
const { buildSystemPrompt } = await import('../openrouter-runner.mjs');
const prompt = buildSystemPrompt('MODE', { shared: 'SHARED', profileMode: 'PROFILE', profile: 'language:\n  output: ja\n', cv: 'CV' });
check(prompt.includes(outputLanguageInstruction()), 'OpenRouter injects English output with an old profile');
function runGeminiEval(modesDirYaml) {
  const tmp = mkdtempSync(join(ROOT, 'co-modes-dir-'));
  try {
    const configDir = join(tmp, 'config');
    mkdirSync(configDir, { recursive: true });
    writeFileSync(join(configDir, 'profile.yml'), `language:\n${modesDirYaml}\n`, 'utf-8');
    writeFileSync(join(tmp, 'cv.md'), 'My CV', 'utf-8');
    mkdirSync(join(tmp, 'modes'), { recursive: true });
    writeFileSync(join(tmp, 'modes', '_profile.md'), 'My Profile', 'utf-8');
    const jdPath = join(tmp, 'mock-jd.txt');
    writeFileSync(jdPath, 'Job description text', 'utf-8');

    const result = spawnSync(NODE, [join(ROOT, 'gemini-eval.mjs'), '--file', jdPath, '--no-save', '--context-only'], {
      cwd: tmp,
      env: { ...process.env, GEMINI_API_KEY: 'mock-api-key-12345', CAREER_OPS_ROOT: tmp },
      encoding: 'utf-8',
      timeout: 30000,
    });
    const stdout = result.stdout || '';
    const stderr = result.stderr || '';
    const childSucceeded = !result.error && result.status === 0;
    check(childSucceeded, 'gemini-eval.mjs context-only child exits successfully');
    if (!childSucceeded) {
      console.error(stderr || result.error?.message || `child exited ${result.status}`);
      return { stdout, stderr, tokenBudget: NaN, evalModeFile: null };
    }

    const tokenBudget = Number(stdout.match(/Token budget: (\d+) tokens/)?.[1] ?? NaN);
    const evalModeFile = stdout.match(/Evaluation mode: ([^\r\n]+)/)?.[1]?.trim() ?? null;
    return { stdout, stderr, tokenBudget, evalModeFile };
  } finally {
    if (existsSync(tmp)) rmSync(tmp, { recursive: true, force: true });
  }
}


for (const config of ['  modes_dir: modes/de', '  modes_dir: [modes/de, modes/zh]', '  output: ja']) {
  const result = runGeminiEval(config);
  check(result.evalModeFile === 'modes/oferta.md', 'Gemini uses baseline evaluation for legacy settings');
  check(!result.stderr.includes('modes/de') && !result.stderr.includes('modes/zh'), 'Gemini never attempts deleted mode packs');
}
