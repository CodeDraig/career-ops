import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as yaml from 'js-yaml';
import { pass, fail } from './helpers.mjs';
import { loadProviders } from '../providers/_registry.mjs';
import { RECIPES } from '../browser-job-search.mjs';
try {
  const config = yaml.load(readFileSync(new URL('../templates/college-search-portals.example.yml', import.meta.url), 'utf8'));
  assert.equal(config.tracked_companies.length, 60);
  const providers = await loadProviders(new URL('../providers', import.meta.url).pathname);
  for (const entry of config.tracked_companies) {
    assert.ok(providers.has(entry.provider), entry.name);
    assert.equal(new URL(entry.careers_url).protocol, 'https:');
    if (entry.provider === 'local-parser') {
      assert.equal(entry.parser.command, 'node'); assert.equal(entry.parser.script, 'browser-job-search.mjs');
      const kind = entry.parser.args[entry.parser.args.indexOf('--kind') + 1];
      assert.ok(RECIPES[kind], entry.name); assert.ok(entry.parser.timeout_ms >= 600000);
    }
  }
  assert.equal(config.tracked_companies.filter(e => !e.enabled).length, 1);
  assert.match(config.tracked_companies.find(e => !e.enabled).careers_url, /hcahealthcare/);
  pass('All 60 example college searches resolve to installed adapters; blocked Galen remains disabled');
} catch (e) { fail(`College configuration: ${e.stack}`); }
