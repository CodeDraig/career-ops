// tests/states-canonical-load.test.mjs — Bug 1 regression: canonical states
// must be loaded from templates/states.yml, not hardcoded in merge-tracker or
// verify-pipeline.
import { mkdirSync, writeFileSync, rmSync } from 'fs';
import { join } from 'path';
import { pathToFileURL } from 'url';
import { pass, fail, ROOT } from './helpers.mjs';

console.log('\nstates — canonical load from states.yml');

const { loadCanonicalStates } = await import(
  pathToFileURL(join(ROOT, 'tracker-utils.mjs')).href
);

const STATES_FILE = join(ROOT, 'templates/states.yml');

// loadCanonicalStates returns all 9 canonical states from the shipped file.
{
  const states = loadCanonicalStates(STATES_FILE);
  const ids = states.map(s => s.id);
  const expected = ['evaluated', 'applied', 'responded', 'interview', 'offer',
                    'rejected', 'discarded', 'skip', 'hired'];
  const missing = expected.filter(id => !ids.includes(id));
  if (missing.length === 0) pass(`all ${expected.length} canonical states present`);
  else fail(`missing state ids: ${missing.join(', ')}`);
}

// Each state has a non-empty label.
{
  const states = loadCanonicalStates(STATES_FILE);
  const noLabel = states.filter(s => !s.label);
  if (noLabel.length === 0) pass('every state has a non-empty label');
  else fail(`states with empty label: ${noLabel.map(s => s.id).join(', ')}`);
}

// State aliases are no longer part of the supported contract.
{
  const states = loadCanonicalStates(STATES_FILE);
  if (states.every(s => !('aliases' in s))) pass('state loader exposes no aliases');
  else fail('state loader retained an alias surface');
}

// A custom states.yml with an extra state is parsed correctly.
{
  const tmp = join(ROOT, '.tmp-states-test-' + process.pid);
  mkdirSync(tmp, { recursive: true });
  try {
    writeFileSync(join(tmp, 'custom-states.yml'), `
states:
  - id: evaluated
    label: Evaluated
    aliases: []
  - id: pending
    label: Pending
    aliases: [waiting, hold]
`);
    const states = loadCanonicalStates(join(tmp, 'custom-states.yml'));
    if (states.length === 2 && states[1].id === 'pending') {
      pass('custom states.yml with extra state parsed correctly');
    } else {
      fail(`unexpected parse result: ${JSON.stringify(states)}`);
    }

    if (states[1].aliases === undefined) pass('old alias configuration is ignored');
    else fail('old alias configuration remains active');

  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

// Malformed file throws rather than silently returning empty/wrong data.
{
  const tmp = join(ROOT, '.tmp-states-bad-' + process.pid);
  mkdirSync(tmp, { recursive: true });
  try {
    writeFileSync(join(tmp, 'bad.yml'), 'not_states: true\n');
    try {
      loadCanonicalStates(join(tmp, 'bad.yml'));
      fail('malformed states file should throw');
    } catch (err) {
      if (/malformed/i.test(err.message)) pass('malformed states file throws with clear message');
      else fail(`malformed states file threw unexpected: ${err.message}`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
