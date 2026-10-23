import assert from 'node:assert/strict';
import { validateInventory, classifySearch } from '../container/validate-colleges.mjs';
import { pass, fail } from './helpers.mjs';

try {
  const schools = Array.from({ length: 346 }, (_, n) => ({ unitid: String(100000 + n), name: `School ${n}`, probeUrl: 'https://example.edu/jobs' }));
  validateInventory({ schools });
  assert.throws(() => validateInventory({ schools: schools.slice(1) }), /346/);
  assert.throws(() => validateInventory({ schools: [...schools.slice(1), schools[1]] }), /346/);
  assert.throws(() => validateInventory({ schools: schools.map((s, n) => n ? s : { ...s, probeUrl: undefined }) }), /346/);
  const job = { title: 'Instructor', url: 'https://example.edu/jobs/1' };
  assert.equal(classifySearch([job], []), 'working');
  assert.equal(classifySearch([], []), 'empty');
  assert.throws(() => classifySearch([job], ['truncated at max_pages=1']), /pagination/);
  assert.throws(() => classifySearch([job], ['stopped at 200 pages']), /pagination/);
  assert.throws(() => classifySearch([job, job], []), /Duplicate/);
  assert.throws(() => classifySearch([{ title: '', url: job.url }], []), /title/);
  pass('Docker college validation requires all 346 schools and rejects partial or malformed search results');
} catch (error) { fail(error.stack); }
