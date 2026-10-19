import assert from 'node:assert/strict';
import workday from '../../providers/workday.mjs';
import sf from '../../providers/successfactors.mjs';
import { pass, fail } from '../helpers.mjs';

try {
  const calls = [];
  const entry = { name: 'College', careers_url: 'https://example.wd1.myworkdayjobs.com/External', workday: { applied_facets: { Institution: ['college123'] } } };
  const jobs = await workday.fetch(entry, { sleep: async () => {}, fetchJson: async (url, opts) => {
    const body = JSON.parse(opts.body); calls.push(body);
    return { total: 21, jobPostings: Array.from({ length: body.offset ? 1 : 20 }, (_, n) => ({ title: `Faculty ${body.offset + n}`, externalPath: `/job/Faculty_R${body.offset + n}`, locationsText: 'Campus', postedOn: 'Posted Today' })) };
  } });
  assert.equal(jobs.length, 21);
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => JSON.stringify(call.appliedFacets) === JSON.stringify(entry.workday.applied_facets)));
  await assert.rejects(workday.fetch({ ...entry, workday: { applied_facets: { Institution: 'college123' } } }, {}), /applied_facets/);
  pass('Workday retains institution filters on every page and rejects malformed facet configuration');
  const splitRequests = [];
  const partitioned = await workday.fetch(entry, { sleep: async () => {}, fetchJson: async (_url, opts) => {
    const body = JSON.parse(opts.body); splitRequests.push(body);
    const tag = body.appliedFacets.jobFamily?.[0];
    return {
      total: tag ? 1 : 2000,
      facets: tag ? [] : [
        { facetParameter: 'Institution', values: [{ id: 'college123', count: 1500 }, { id: 'otherCollege', count: 1500 }] },
        { facetParameter: 'jobFamily', values: [{ id: 'a', count: 1500 }, { id: 'b', count: 1500 }] },
      ],
      jobPostings: Array.from({ length: tag ? 1 : 20 }, (_, n) => ({ title: 'Faculty', externalPath: `/job/${tag || 'root'}-${body.offset + n}`, postedOn: 'Posted Today' })),
    };
  } });
  assert.equal(partitioned.length, 2002);
  assert.ok(splitRequests.every(call => JSON.stringify(call.appliedFacets.Institution) === '["college123"]'));
  assert.deepEqual([...new Set(splitRequests.flatMap(call => call.appliedFacets.jobFamily || []))].sort(), ['a', 'b']);
  pass('Workday partition recovery preserves the selected institution and never expands into another college');


  const requests = [];
  const result = await sf.fetch({ name: 'Brand', careers_url: 'https://careers.example.edu/CollegeBrand', sfVariant: 'csb', successfactors: { facet_filters: { filter1: ['Campus'] } } }, {
    fetchText: async () => '<a href="?locale=en_US">English</a><script>window.appParams = {brand: "CollegeBrand"};</script>',
    fetchJson: async (url, opts) => {
      const body = JSON.parse(opts.body); requests.push({ url, body });
      return { totalJobs: 11, jobSearchResult: Array.from({ length: body.pageNumber ? 1 : 10 }, (_, n) => ({ response: { id: String(body.pageNumber * 10 + n), unifiedStandardTitle: 'Faculty', unifiedUrlTitle: 'Faculty', jobLocationShort: ['Campus'] } })) };
    },
  });
  assert.equal(result.length, 11);
  assert.equal(requests.length, 2);
  for (const { url, body } of requests) {
    assert.equal(url, 'https://careers.example.edu/services/recruiting/v1/jobs');
    assert.equal(body.brand, 'CollegeBrand'); assert.equal(body.sortBy, 'date');
    assert.deepEqual(body.facetFilters, { filter1: ['Campus'] });
  }
  pass('SuccessFactors uses current date sorting, the root brand API, and campus filters throughout pagination');
} catch (error) { fail(error.stack); }
