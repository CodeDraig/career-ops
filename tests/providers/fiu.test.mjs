import assert from 'node:assert/strict';
import { pass, fail } from '../helpers.mjs';
import fiu, { parseFiuJobs } from '../../providers/fiu.mjs';

try {
  const row = { JOB_OPENING_ID: 123, POSTING_TITLE: 'Faculty', URL: 'https://pslinks.fiu.edu/psp/jobs', LOCATION: 'Miami', DESCRIPTION: '<p>Teach &amp; research</p>' };
  assert.equal(parseFiuJobs({ JOB_POSTINGS: [row] }, 'FIU')[0].description, 'Teach & research');
  assert.deepEqual(parseFiuJobs({ JOB_POSTINGS: [] }, 'FIU'), []);
  assert.throws(() => parseFiuJobs({ error: 'Unavailable' }, 'FIU'), /unrecognized/);
  assert.equal(parseFiuJobs({ JOB_POSTINGS: [{ ...row, URL: 'https://unrelated.example/job' }, { ...row, JOB_OPENING_ID: 'not-an-id' }] }, 'FIU').length, 0);
  let requested;
  assert.equal((await fiu.fetch({ name: 'FIU' }, { fetchJson: async url => { requested = url; return { JOB_POSTINGS: [row] }; } })).length, 1);
  assert.equal(requested, 'https://search.careers.fiu.edu/api/jobs');
  assert.equal(fiu.detect({ careers_url: 'https://search.careers.fiu.edu.evil.example/' }), null);
  pass('FIU public feed distinguishes empty, invalid and off-host records');

} catch (e) { fail(`FIU feed: ${e.stack}`); }
