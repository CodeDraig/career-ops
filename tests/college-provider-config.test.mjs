import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as yaml from 'js-yaml';
import { pass, fail } from './helpers.mjs';
import { loadProviders } from '../providers/_registry.mjs';
import { RECIPES } from '../browser-job-search.mjs';

try {
  const text = readFileSync(new URL('../templates/college-provider-portals.example.yml', import.meta.url), 'utf8');
  const config = yaml.load(text);
  const ledger = JSON.parse(readFileSync(new URL('../docs/college-provider-validation-2026-10-19.json', import.meta.url)));
  const previous = readFileSync(new URL('../templates/college-search-portals.example.yml', import.meta.url), 'utf8');
  const ids = [...text.matchAll(/# UNITID (\d+)/g)].map(match => match[1]);
  const priorIds = new Set([...previous.matchAll(/# UNITID (\d+)/g)].map(match => match[1]));
  assert.equal(config.tracked_companies.length, 172);
  assert.equal(new Set(ids).size, 172);
  assert.ok(ids.every(id => !priorIds.has(id)), 'The two cohorts must not double-count a school');
  assert.deepEqual(ids, ledger.schools.map(row => row.id));
  const providers = await loadProviders(new URL('../providers', import.meta.url).pathname);
  for (const [index, entry] of config.tracked_companies.entries()) {
    const row = ledger.schools[index];
    assert.ok(providers.has(entry.provider), row.name);
    assert.equal(entry.enabled, true);
    assert.equal(entry.careers_url, row.careersUrl);
    assert.ok(row.complete && row.ownershipEvidence.file && row.paginationEvidence, row.name);
    if (row.scopeType === 'shared-employer' || row.scopeType === 'successor-employer') {
      assert.match(entry.name, /shared employer board|successor employer/, row.name);
    }
    if (entry.provider === 'local-parser') {
      assert.equal(entry.parser.script, 'browser-job-search.mjs');
      const kind = entry.parser.args[entry.parser.args.indexOf('--kind') + 1];
      assert.ok(RECIPES[kind], row.name);
    }
  }
  assert.equal(ledger.schools.filter(row => row.count > 0).length, ledger.working);
  assert.equal(ledger.schools.filter(row => row.status === 'empty').length, ledger.empty);
  assert.equal(ledger.successful, ledger.working + ledger.empty);
  assert.equal(ledger.fullInventory.successful, ledger.successful + 59);
  assert.equal(ledger.fullInventory.successful + ledger.fullInventory.unresolved, 346);
  pass('172 opt-in college routes match the ownership ledger, use installed providers, and do not overlap the prior 60-school cohort');
} catch (error) { fail(error.stack); }
