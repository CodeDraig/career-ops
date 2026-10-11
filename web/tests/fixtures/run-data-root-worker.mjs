// Deterministic worker for the real /api/run integration test. No model calls.
// Execute the prompt's actual persistence commands from its actual working
// directory; a relative script path under the data directory fails here.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';

const prompt = process.argv[2];
assert.equal(process.cwd(), process.env.CAREER_OPS_ROOT);
fs.writeFileSync('received-prompt.txt', prompt);
const modePath = JSON.parse(prompt.match(/1\. Read ("[^"\n]+")/)[1]);
assert.ok(fs.readFileSync(modePath, 'utf8').length > 0);
assert.match(fs.readFileSync('cv.md', 'utf8'), /Fictional Fixture/);

if (prompt.includes('You are tailoring')) {
  const template = JSON.parse(prompt.match(/3\. Fill ("[^"\n]+")/)[1]);
  assert.ok(fs.readFileSync(template, 'utf8').includes('{{NAME}}'));
  const html = '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Fixture CV</title></head><body><h1>Fictional Fixture</h1><p>Fixture engineer.</p></body></html>';
  process.stdout.write(`<<cv-html format="letter">>\n${html}\n<</cv-html>>\nVERDICT: 5/5 — Fixture content complete\n`);
} else {
  const reserve = prompt.match(/Reserve a report number: run `([^`]+)`/)[1];
  const merge = prompt.match(/Merge into the tracker: run `([^`]+)`/)[1];
  const num = execSync(reserve, { encoding: 'utf8' }).trim();
  assert.match(num, /^\d{3,}$/);
  const date = prompt.match(/Today is (\d{4}-\d{2}-\d{2})/)[1];
  const file = `reports/${num}-fictional-fixture-${date}.md`;
  fs.writeFileSync(file, '# Fictional fixture evaluation\n\n## Job Description (archived verbatim)\nFixture role.\n');
  fs.mkdirSync('batch/tracker-additions', { recursive: true });
  fs.writeFileSync(path.join('batch/tracker-additions', `${num}-fictional.tsv`),
    'num\tdate\tcompany\trole\tstatus\tscore\tpdf\treport\tnotes\turl\n' +
    `${num}\t${date}\tFictional Fixture\tEngineer\tEvaluated\t3/5\t❌\t[${num}](${file})\tFixture\thttps://fixture.invalid/jobs/1\n`);
  const merged = execSync(merge, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  fs.writeFileSync('merge-result.txt', merged);
  process.stdout.write('VERDICT: 3/5 — Fixture evaluation persisted\n');
}
