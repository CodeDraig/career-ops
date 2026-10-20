import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {load} from 'js-yaml';
import {loadProviders,resolveProvider} from '../providers/_registry.mjs';
import {pass,fail} from './helpers.mjs';
try {
  const read=name=>JSON.parse(readFileSync(new URL('../docs/'+name,import.meta.url)));
  const ledger=read('college-final-eight-validation-2026-10-19.json'),prior=read(ledger.baselineLedger);
  assert.equal(ledger.schools.length,8);assert.equal(new Set(ledger.schools.map(r=>r.unitid)).size,8);
  assert.deepEqual(ledger.schools.map(r=>r.unitid).sort(),prior.schools.filter(r=>!r.complete).map(r=>r.unitid).sort());
  const completed=ledger.schools.filter(r=>r.complete);
  assert.equal(ledger.baselineValidated,prior.validatedTotal);assert.equal(ledger.newValidated,completed.length);
  assert.equal(ledger.validatedTotal,prior.validatedTotal+completed.length);
  assert.equal(ledger.nonemptyTotal,prior.nonemptyTotal+completed.filter(r=>r.postings>0).length);
  assert.equal(ledger.emptyTotal,prior.emptyTotal+completed.filter(r=>r.postings===0).length);
  assert.equal(ledger.unresolvedTotal,8-completed.length);
  assert.equal(ledger.validatedTotal+ledger.unresolvedTotal,346);
  assert.equal(ledger.coveragePercent,Math.round(ledger.validatedTotal/346*10000)/100);
  assert.equal(ledger.sourceDatabaseSha256,prior.sourceDatabaseSha256);
  const example=load(readFileSync(new URL('../templates/college-final-eight-portals.example.yml',import.meta.url),'utf8'));
  assert.deepEqual(example.tracked_companies,completed.map(r=>r.entry));
  const providers=await loadProviders(fileURLToPath(new URL('../providers',import.meta.url)));
  for(const row of ledger.schools){
    assert.match(row.resultSha256,/^[a-f0-9]{64}$/);assert.ok(row.reason);
    if(row.complete){assert.ok(row.scope);assert.ok(row.pagination.complete);assert.ok(resolveProvider(row.entry,providers)?.provider);assert.ok(row.entry.enabled);}
    else assert.equal(row.entry,undefined);
  }
  pass('Final eight revalidation overlays only previous failures; 346-school coverage and five enabled routes reconcile');
}catch(e){fail(e.stack);}
