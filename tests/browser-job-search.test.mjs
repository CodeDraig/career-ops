import assert from 'node:assert/strict';
import { pass, fail, run } from './helpers.mjs';
import { normalizeSearchPage, searchBrowserJobs } from '../browser-job-search.mjs';
const url = 'https://careers.example.edu/jobs/search?employment_type_uids[]=faculty&employment_type_uids[]=adjunct';
const options = { url, company: 'Example College', kind: 'clinch' };
const raw = { recognized: true, documentUrl: url, rows: [{ title: ' Faculty   of Science ', url: '/jobs/science', location: 'Remote' }], text: 'Faculty of Science', next: '?page=2' };
try {
  const parsed = normalizeSearchPage(raw, options);
  assert.equal(parsed.jobs[0].title, 'Faculty of Science');
  assert.equal(parsed.jobs[0].location, 'Remote');
  assert.deepEqual(new URL(parsed.next).searchParams.getAll('employment_type_uids[]'), ['faculty', 'adjunct']);
  assert.equal(new URL(parsed.next).searchParams.get('page'), '2');
  assert.throws(() => normalizeSearchPage({ ...raw, recognized: false }, options), /Unrecognized/);
  assert.throws(() => normalizeSearchPage({ ...raw, rows: [], text: 'Please sign in' }, options), /No posting/);
  assert.deepEqual(normalizeSearchPage({ ...raw, rows: [], next: null, text: 'No result found' }, options).jobs, []);
  assert.throws(() => normalizeSearchPage({ ...raw, rows: [], next: null, text: 'No result found' }, { ...options, kind: 'georgia' }), /empty search is unverified/);
  assert.equal(normalizeSearchPage({ ...raw, text: 'Showing 1-10 of 75 jobs' }, { ...options, kind: 'wgu' }).reportedTotal, 75);
  assert.throws(() => normalizeSearchPage({ ...raw, next: 'https://elsewhere.example/page2' }, options), /pagination left/);
  const filtered = normalizeSearchPage({ ...raw, rows: [...raw.rows, ...raw.rows,
    { title: 'Apply now', url: '/apply' }, { title: 'Offsite', url: 'https://other.example/jobs/1' },
    { title: 'Missing URL' }, { title: 'Private', url: 'http://127.0.0.1/jobs/1' }] }, options);
  assert.equal(filtered.jobs.length, 1);
  const sdi = normalizeSearchPage({ ...raw, documentUrl: 'https://sdi.edu/faculty-careers/', next: null, rows: [{ title: 'Faculty', url: 'https://recruiting.paylocity.com/recruiting/jobs/Details/123/faculty' }, { title: 'Navigation', url: 'https://recruiting.paylocity.com/login' }] }, { ...options, kind: 'sdiFaculty' });
  assert.equal(sdi.jobs.length, 1);
  assert.equal(normalizeSearchPage({ ...raw, documentUrl: 'https://hccs.referrals.selectminds.com/jobs/search/123', next: '#page2' }, { ...options, kind: 'selectminds' }).next, 'https://hccs.referrals.selectminds.com/jobs/search/123#page2');
  pass('Browser searches preserve repeated filters, reject navigation and distinguish empty searches from broken pages');
  await assert.rejects(searchBrowserJobs({ ...options, kind: 'unknown' }), /Unknown/);
  await assert.rejects(searchBrowserJobs({ ...options, maxPages: 0 }), /maxPages/);
  await assert.rejects(searchBrowserJobs({ ...options, url: 'http://localhost/jobs' }), /public/);
  await assert.rejects(searchBrowserJobs({ ...options, company: '' }), /company/);
  assert.match(run('node', ['browser-job-search.mjs', '--help']), /--kind/);
  pass('Browser search validates inputs before launching and exposes CLI help');
} catch (e) { fail(`Browser search: ${e.stack}`); }
