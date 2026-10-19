import assert from 'node:assert/strict';
import { pass, fail } from '../helpers.mjs';
import isolved, { parseIsolvedJobs } from '../../providers/isolvedhire.mjs';

try {
  const origin = 'https://college.isolvedhire.com';
  const job = { id: 42, title: 'Faculty &amp; Tutor', jobUrl: origin + '/jobs/42.html', city: 'Miami', stateName: 'Florida', iso3: 'USA' };
  const payload = { success: true, data: { jobs: [job], jobCount: 1 } };
  assert.equal(parseIsolvedJobs(payload, origin, 'College')[0].title, 'Faculty & Tutor');
  assert.throws(() => parseIsolvedJobs({ ...payload, data: { ...payload.data, jobCount: 2 } }, origin, 'College'), /incomplete/);
  assert.throws(() => parseIsolvedJobs({ success: false }, origin, 'College'), /unrecognized/);
  assert.deepEqual(parseIsolvedJobs({ success: true, data: { jobs: [], jobCount: 0 } }, origin, 'College'), []);
  assert.deepEqual(parseIsolvedJobs({ success: true, data: { jobs: [{ ...job, jobUrl: 'https://elsewhere.example/jobs/42' }] } }, origin, 'College'), []);
  for (const careers_url of ['http://college.isolvedhire.com', 'https://isolvedhire.com.evil.example', 'https://user@college.isolvedhire.com']) assert.equal(isolved.detect({ careers_url }), null);
  const calls = [];
  const jobs = await isolved.fetch({ name: 'College', careers_url: origin }, {
    fetchText: async url => { calls.push(url); return '<script>{"domain_id":"8712"}</script>'; },
    fetchJson: async url => { calls.push(url); return payload; },
  });
  assert.equal(jobs.length, 1);
  assert.equal(new URL(calls[1]).pathname, '/core/jobs/8712');
  assert.deepEqual(JSON.parse(new URL(calls[1]).searchParams.get('getParams')), { isInternal: 0 });
  pass('isolved resolves the published employer ID and requests only its complete public feed');

} catch (e) { fail(`isolved Hire feed: ${e.stack}`); }
