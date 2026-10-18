import assert from 'node:assert/strict';
import { pass, fail } from '../helpers.mjs';
import provider, { parsePeopleadminListing } from '../../providers/peopleadmin.mjs';
const entry = { name: 'Example College', careers_url: 'https://example.peopleadmin.com/' };
const row = (id, title = 'Writing &amp; Composition Instructor') => `<div class="job-item"><h3><a href="/postings/${id}">${title}</a></h3><a href="/postings/${id}">View Details</a></div>`;
const page = (rows, more = false) => `<div id="search_results">${rows}</div>${more ? '<a rel="next" href="https://evil.invalid/postings/search?page=2">Next</a>' : ''}`;
try {
  assert.equal(provider.id, 'peopleadmin');
  assert.ok(provider.detect(entry));
  assert.ok(provider.detect({ ...entry, careers_url: 'https://example.peopleadmin.com/postings/123' }));
  for (const careers_url of [null, 42, '', 'broken', 'http://example.peopleadmin.com/', 'https://example.peopleadmin.com.evil.invalid/', 'https://jobs.example.edu/postings/search']) assert.equal(provider.detect({ ...entry, careers_url }), null);
  assert.ok(provider.detect({ ...entry, provider: 'peopleadmin', careers_url: 'https://jobs.example.edu/' }));
  pass('PeopleAdmin routes vendor hosts and requires explicit branded-host configuration');
  const parsed = parsePeopleadminListing(page(row(1) + row(1) + row(2, '') + '<h3><a href="https://evil.invalid/postings/9">Bad</a></h3>'), 'https://example.peopleadmin.com/postings/search', entry.name);
  assert.equal(parsed.jobs.length, 1);
  assert.equal(parsed.jobs[0].title, 'Writing & Composition Instructor');
  assert.equal(parsed.jobs[0].location, '');
  assert.deepEqual(parsePeopleadminListing(page(''), entry.careers_url, entry.name).jobs, []);
  assert.throws(() => parsePeopleadminListing('<html>Login</html>', entry.careers_url, entry.name), /container/);
  assert.throws(() => parsePeopleadminListing(page('<a href="/postings/1">View Details</a>'), entry.careers_url, entry.name), /no titles/);
  pass('PeopleAdmin decodes titles, deduplicates, rejects malformed rows and distinguishes empty from broken');
  let calls = [];
  const ctx = { sleep: async () => {}, fetchText: async (url, opts) => {
    calls.push(url); assert.equal(opts.redirect, 'error');
    assert.equal(new URL(url).hostname, 'example.peopleadmin.com');
    return page(row(calls.length), calls.length < 3);
  }};
  const jobs = await provider.fetch({ ...entry, careers_url: 'https://example.peopleadmin.com/postings/search?query=adjunct&page=8' }, ctx);
  assert.equal(jobs.length, 3); assert.equal(calls.length, 3);
  assert.ok(calls.every(u => new URL(u).searchParams.get('query') === 'adjunct'));
  assert.equal(new URL(calls[0]).searchParams.get('page'), '1');
  calls = []; await provider.fetch(entry, { ...ctx, maxPages: 1 }); assert.equal(calls.length, 1);
  const error = new Error('probe failed');
  await assert.rejects(provider.fetch(entry, { maxPages: 1, fetchText: async () => { throw error; } }), e => e === error);
  let fetched = false;
  await assert.rejects(provider.fetch({ ...entry, careers_url: 'https://evil.invalid/' }, { fetchText: async () => { fetched = true; } })); assert.equal(fetched, false);
  pass('PeopleAdmin preserves filters, rebuilds pagination on the same origin, bounds probes and propagates failures');
  const oldWarn = console.error; const warnings = []; console.error = msg => warnings.push(msg);
  try {
    let count = 0;
    const endless = { sleep: async () => {}, fetchText: async () => page(row(++count), true) };
    await provider.fetch(entry, endless); assert.equal(count, 50);
    count = 0; await provider.fetch({ ...entry, max_pages: 9999 }, endless); assert.equal(count, 200);
    assert.equal(warnings.length, 2);
  } finally { console.error = oldWarn; }
  await assert.rejects(provider.fetch(entry, { sleep: async () => {}, fetchText: async () => page(row(1), true) }), /did not advance/);
  let attempts = 0;
  const transient = Object.assign(new Error('temporary'), { status: 503 });
  const retryJobs = await provider.fetch(entry, { sleep: async () => {}, fetchText: async () => {
    attempts++;
    if (attempts === 2) throw transient;
    return page(row(attempts === 1 ? 1 : 2), attempts === 1);
  }});
  assert.equal(attempts, 3); assert.equal(retryJobs.length, 2);
  attempts = 0;
  await assert.rejects(provider.fetch(entry, { sleep: async () => {}, fetchText: async () => {
    if (++attempts === 1) return page(row(1), true);
    throw transient;
  }}), /temporary/);
  assert.equal(attempts, 4);
  pass('PeopleAdmin default and absolute ceilings warn, and repeated pagination fails loudly');
} catch (e) { fail(`PeopleAdmin: ${e.stack}`); }
