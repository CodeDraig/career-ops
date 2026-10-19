import assert from 'node:assert/strict';
import { pass, fail } from '../helpers.mjs';
import neogov from '../../providers/neogov.mjs';
import { resolveConfig, buildDetailUrl } from '../../providers/peoplesoft.mjs';

try {
  const entry = { name: 'College', careers_url: 'https://www.governmentjobs.com/careers/louisiana?department[0]=Bossier%20Community%20College&department[]=Another%20College' };
  const seen = [];
  await neogov.fetch(entry, { sleep: async () => {}, fetchText: async url => {
    seen.push(url);
    return seen.length === 1 ? '<li class="list-item"><a class="item-details-link" href="/careers/louisiana/jobs/123/faculty">Faculty</a></li>' : '<div class="jobs-not-found-container">No jobs</div>';
  } });
  assert.equal(seen.length, 2);
  for (const url of seen) assert.deepEqual(new URL(url).searchParams.getAll('department'), ['Bossier Community College', 'Another College']);
  pass('NEOGOV keeps employer department filters on every page of a shared agency board');

  for (const [portal, node, siteId] of [['RECRUIT', 'JOBS', '1000'], ['CAREERS', 'HRMS', '03000']]) {
    const cfg = resolveConfig({ careers_url: `https://college.example/psc/careers/${portal}/${node}/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL?SiteId=${siteId}` });
    assert.ok(cfg);
    assert.equal(new URL(cfg.searchUrl).searchParams.get('SiteId'), siteId);
    const detail = new URL(buildDetailUrl(cfg, '123', '2'));
    assert.equal(detail.pathname, new URL(cfg.searchUrl).pathname);
    assert.equal(detail.searchParams.get('SiteId'), siteId);
    assert.equal(detail.searchParams.get('JobOpeningId'), '123');
  }
  assert.equal(resolveConfig({ careers_url: 'https://college.example/psc/careers/CAREERS/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL?SiteId=bad' }), null);
  pass('PeopleSoft preserves public portal/node and zero-prefixed SiteId in search and detail URLs');
} catch (e) { fail(`College routing regressions: ${e.stack}`); }
