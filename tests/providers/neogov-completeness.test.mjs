import assert from 'node:assert/strict';
import neogov from '../../providers/neogov.mjs';
import { pass, fail } from '../helpers.mjs';

const entry = { name: 'College', careers_url: 'https://www.schooljobs.com/careers/college' };
const page = id => `<span id="job-postings-number">2</span><li class="list-item"><a class="item-details-link" href="/careers/college/jobs/${id}/faculty">Faculty ${id}</a></li>`;
try {
  const requests = [];
  const jobs = await neogov.fetch(entry, { sleep: async () => {}, fetchText: async url => {
    requests.push(url);
    return requests.length < 3 ? page(requests.length) : '<div class="jobs-not-found-container">No jobs</div>';
  } });
  assert.equal(jobs.length, 2);
  assert.ok(requests.every(url => new URL(url).searchParams.get('sort') === 'PositionTitle' && new URL(url).searchParams.get('isDescendingSort') === 'false'));
  const recovered = await neogov.fetch({ ...entry, max_pages: 3 }, { sleep: async () => {}, fetchText: async url => {
    const query = new URL(url).searchParams;
    if (query.get('isDescendingSort') === 'true') return query.get('page') === '1' ? page(2) : '<div class="jobs-not-found-container">No jobs</div>';
    return page(1);
  } });
  assert.deepEqual(recovered.map(job => job.title), ['Faculty 1', 'Faculty 2']);
  await assert.rejects(neogov.fetch(entry, { sleep: async () => {}, fetchText: async () => page(1) }), /received 1 of 2/);
  await assert.rejects(neogov.fetch({ ...entry, max_pages: 1 }, { fetchText: async () => page(1) }), /incomplete search/);
  assert.equal((await neogov.fetch(entry, { maxPages: 1, fetchText: async () => page(1) })).length, 1);
  pass('NEOGOV uses title order and refuses incomplete advertised inventories while retaining bounded health probes');
} catch (error) { fail(error.stack); }
