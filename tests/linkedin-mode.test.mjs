// Prompt contracts: these catch lost wiring/guards, not LLM compliance.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { ROOT, pass, fail } from './helpers.mjs';
import { join } from 'node:path';

const read = path => readFileSync(join(ROOT, path), 'utf8').replace(/\s+/g, ' ');
const mode = read('modes/linkedin.md');
const agents = read('AGENTS.md');
const checks = [
  ['interactive tool boundary', () => {
    for (const tool of ['search_jobs', 'get_job_details', 'get_job_apply_url']) assert.ok(mode.includes(tool));
    assert.match(mode, /do not launch a server, edit host configuration, add dependencies, or dispatch a background\/web worker/i);
    assert.match(mode, /If unavailable or disabled,.*stop this mode/);
    assert.match(mode, /never sends messages.*submits applications/);
  }],
  ['search preserves filter failures and bounded results', () => {
    assert.match(mode, /max_pages: 1/);
    assert.match(mode, /location` is a separate geographic constraint/);
    assert.match(mode, /filters_dropped.*before the results/);
    assert.match(mode, /no_matching_jobs/);
    assert.match(mode, /Do not associate companies or locations merely by adjacent line order/);
    assert.match(mode, /Search alone writes no pipeline, scan-history, report, CV or tracker files/);
  }],
  ['MCP and evaluation share one extraction attempt', () => {
    assert.match(agents, /get_job_details` over the generic browser path/);
    assert.match(agents, /That call consumes the same one-attempt extraction budget/);
    assert.match(mode, /description_missing/);
    assert.match(mode, /stop before evaluation\/report\/CV\/tracker writes/);
    assert.match(mode, /raw JD, extraction-attempt state, warnings and employer-verification state/);
    assert.match(read('modes/auto-pipeline.md'), /earlier extraction from `pipeline` or `linkedin`/);
    assert.match(mode, /aggregator employer-confirmation gate/);
  }],
  ['application lookup does not imply account writes or liveness', () => {
    for (const type of ['external', 'easy_apply', 'applied', 'closed', 'unknown']) assert.ok(mode.includes('`' + type + '`'));
    assert.match(mode, /not permission to change the tracker/);
    assert.match(mode, /does not authorize clicking Apply/);
  }],
  ['mode ships through system updates and uses the data-root contract', () => {
    assert.ok(read('update-system.mjs').includes("'modes/linkedin.md'"));
    assert.match(mode, /Resolve user files through `path-resolver.mjs`/);
    assert.match(mode, /never copy or rewrite profiles/);
    assert.match(read('.agents/skills/career-ops/SKILL.md'), /This mode is interactive-only; do not dispatch it to a headless worker or web run/);
  }],
];
for (const [name, check] of checks) {
  try { check(); pass(name); } catch (error) { fail(`${name}: ${error.message}`); }
}
