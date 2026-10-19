import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {load} from 'js-yaml';
import {fileURLToPath} from 'node:url';
import {loadProviders,resolveProvider} from '../providers/_registry.mjs';
import {pass,fail} from './helpers.mjs';
try {
  const ledger=JSON.parse(readFileSync(new URL('../docs/college-remaining-validation-2026-10-19.json',import.meta.url)));
  const example=load(readFileSync(new URL('../templates/college-remaining-portals.example.yml',import.meta.url),'utf8'));
  assert.equal(ledger.schools.length,115);assert.equal(new Set(ledger.schools.map(r=>r.unitid)).size,115);
  const prior=JSON.parse(readFileSync(new URL('../docs/college-provider-validation-2026-10-19.json',import.meta.url)));
  const browserExample=readFileSync(new URL('../templates/college-search-portals.example.yml',import.meta.url),'utf8');
  const oldIds=new Set([...prior.schools.map(r=>String(r.id)),...[...browserExample.matchAll(/# UNITID (\d+):/g)].map(m=>m[1]).filter(id=>id!=='156471')]);
  assert.equal(oldIds.size,231);
  assert.ok(ledger.schools.every(r=>!oldIds.has(r.unitid)));
  assert.equal(new Set([...oldIds,...ledger.schools.map(r=>r.unitid)]).size,346);
  const complete=ledger.schools.filter(r=>r.complete),nonempty=complete.filter(r=>r.postings>0),empty=complete.filter(r=>r.postings===0);
  assert.equal(ledger.newValidated,complete.length);assert.equal(ledger.newNonempty,nonempty.length);assert.equal(ledger.newEmpty,empty.length);
  assert.equal(ledger.validatedTotal,ledger.priorValidated+complete.length);
  assert.equal(ledger.unresolvedTotal,ledger.schools.length-complete.length);
  assert.equal(ledger.validatedTotal+ledger.unresolvedTotal,346);
  assert.equal(ledger.coveragePercent,Math.round(ledger.validatedTotal/346*10000)/100);
  assert.deepEqual(example.tracked_companies,complete.map(r=>r.entry));
  const providers=await loadProviders(fileURLToPath(new URL('../providers',import.meta.url)));
  for(const row of ledger.schools){
    assert.ok(row.savedUrlsInspected.length);assert.match(row.resultSha256,/^[a-f0-9]{64}$/);
    if(row.complete){assert.ok(row.scope);assert.ok(row.pagination);assert.ok(resolveProvider(row.entry,providers)?.provider);assert.ok(row.entry.enabled);}
    else {assert.ok(row.reason);assert.equal(row.entry,undefined);}
  }
  pass('All 115 schools have evidence; coverage reconciles and enabled examples contain only completed routes');
} catch(e){fail(`Remaining college coverage: ${e.stack}`);}
