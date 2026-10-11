import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ROOT, rmSync } from './helpers.mjs';

test('OpenAI-compatible evaluator sends authoritative archetypes from the separate data root', async (t) => {
  const data = mkdtempSync(join(tmpdir(), 'co-openai-profile-'));
  t.after(() => rmSync(data, { recursive: true, force: true }));
  mkdirSync(join(data, 'config'));
  mkdirSync(join(data, 'modes'));
  writeFileSync(join(data, 'cv.md'), '# Fictional fixture candidate\n');
  writeFileSync(join(data, 'config/profile.yml'), 'language:\n  output: en\nnorth_star: FIXTURE_YAML_TARGET\n');
  const archetype = 'FIXTURE_AUTHORITATIVE_ARCHETYPE_REMOTE_ONLY';
  writeFileSync(join(data, 'modes/_profile.md'), `## Your Target Roles\n${archetype}\n`);
  let messages;
  const server = createServer((req, res) => {
    let text = '';
    req.on('data', (chunk) => { text += chunk; });
    req.on('end', () => {
      messages = JSON.parse(text).messages;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: 'Fictional fixture evaluation.\nVERDICT: 3/5' } }] })}\n\ndata: [DONE]\n\n`);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}/v1`;
  const result = await new Promise((resolve) => execFile(process.execPath,
    [join(ROOT, 'openai-eval.mjs'), '--url', url, '--model', 'fixture', '--no-save', 'Fictional remote engineer role.'],
    { cwd: data, timeout: 30_000, env: { ...process.env, CAREER_OPS_ROOT: data, CAREER_OPS_TRACKER: '', OPENAI_API_KEY: '', OPENAI_BASE_URL: url } },
    (error, stdout, stderr) => resolve({ error, stdout, stderr })));
  assert.ifError(result.error);
  const content = messages.find((m) => m.role === 'system').content;
  const prompt = typeof content === 'string' ? content : content.map((part) => part.text ?? '').join('\n');
  assert.match(prompt, /FIXTURE_YAML_TARGET/);
  assert.ok(prompt.includes(archetype), 'the actual outgoing request must contain _profile.md');
  assert.ok(prompt.indexOf(archetype) > prompt.indexOf('## Archetype Detection'), 'user archetypes follow shared defaults');
  assert.deepEqual(readdirSync(data).sort(), ['config', 'cv.md', 'modes'], '--no-save writes no evaluation artifacts');
});
