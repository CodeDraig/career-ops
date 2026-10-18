import assert from 'node:assert/strict';
import { pass, fail } from '../helpers.mjs';
import avature, { parseArticles, countArticles } from '../../providers/avature.mjs';
const row = id => `<li class="listSingleColumnItem"><div><h3 class="listSingleColumnItemTitle"><a href="/careers/JobDetail/Faculty/${id}">Writing &amp; Composition Faculty ${id}</a></h3></div><ul><li>Share</li></ul><a href="/careers/JobDetail/Faculty/${id}">Read more</a></li>`;
const featured = '<li class="listDetailItem"><h3><a href="/careers/JobDetail/Featured/999">Featured</a></h3></li>';
try {
  const html = featured + Array.from({length:10}, (_, i) => row(i + 1)).join('') + '<a href="/careers/SearchJobs/?jobOffset=10" class="paginationItem paginationNextLink">Next</a>';
  assert.equal(countArticles(html), 10);
  const parsed = parseArticles(html, 'https://example.avature.net');
  assert.equal(parsed.length, 10); assert.equal(parsed[0].title, 'Writing & Composition Faculty 1');
  const calls = [];
  const jobs = await avature.fetch({ name: 'Example', careers_url: 'https://example.avature.net/careers/SearchJobs' }, {
    sleep: async () => {}, fetchText: async (url, opts) => {
      assert.equal(opts.redirect, 'error'); calls.push(url);
      return calls.length === 1 ? html : row(11) + row(12);
    },
  });
  assert.equal(jobs.length, 12); assert.equal(calls.length, 2);
  assert.equal(new URL(calls[1]).searchParams.get('jobOffset'), '10');
  assert.ok(!jobs.some(j => j.title === 'Featured'));
  pass('Avature legacy list cards decode titles, exclude featured duplicates and paginate by the observed ten-row stride');
} catch (e) { fail(`Avature legacy lists: ${e.stack}`); }
