// Run explicitly with installed Playwright Chromium; no external network.
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { readDom } from '../browser-extract.mjs';
import { RECIPES, readSearchPage, normalizeSearchPage, searchBrowserJobs } from '../browser-job-search.mjs';
import { pass, fail } from './helpers.mjs';
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage();
  const fixtures = {
    bmcc: '<div class="entry-content"><div class="content-box"><ul><li><a href="https://bmccprodstroac.blob.core.windows.net/uploads/2026/faculty.pdf">Faculty</a></li></ul></div></div>',
    clinch: '<div id="jobs_search_results_1"><article><a id="link_job_title_1" href="/jobs/1">Faculty</a></article></div>',
    pageup: '<table id="search-results-content"><tr><td><a class="job-link" href="/jobs/1">Faculty</a></td><td class="location">Remote</td></tr></table>',
    interviewexchange: '<div class="job-card"><h2><a href="/jobs/1">Faculty</a></h2></div>',
    post: '<main id="main-content"><a href="/associate-experience/career-opportunities/">Navigation</a><a href="/associate-experience/career-opportunities/faculty/">Faculty</a></main>',
    excelsior: '<main><a class="stretched-link" href="/job/faculty/">Faculty</a></main>',
    wgu: '<div class="results-list"><div class="results-list__item"><a class="results-list__item-title--link" href="/jobs/1">Faculty</a></div><a aria-label="Next Page" href="?page=2">Next</a></div>',
    umgc: '<div id="job-list-section"><a href="/job/1">Faculty</a></div>',
    hca: '<div id="job-list-inner"><div class="jobs-section__item"><h2><a href="/jobs/1">Faculty</a></h2></div></div>',
    seminole: '<div class="jsJob" data-url="/ssap/jobs/jobView/123"><h3>Faculty</h3></div>',
    attrax: '<div class="attrax-list-widget__list"><a class="attrax-vacancy-tile__title" href="/jobs/1">Faculty</a><a aria-label="Next pagination page" href="/jobs?page=2">Next</a></div>',
    taleoBusiness: '<div class="oracletaleocwsv2-accordion"><a class="viewJobLink" href="/viewRequisition?rid=1">Faculty</a></div>',
    sdiFaculty: '<main id="main"><div class="job"><div class="course-heading">Faculty</div><a href="https://recruiting.paylocity.com/recruiting/jobs/Details/1/faculty">Apply Now</a></div></main>',
    georgia: '<div class="view-jobs-search"><div class="job-title"><a href="/faculty">Faculty</a></div></div>',
    selectminds: '<div class="jResultsActive"><div class="job_list_row"><a class="job_link" href="/jobs/1">Faculty</a></div><span id="jPaginateCurrPage">1</span><a class="next" href="#page2">Next</a></div>',
  };
  assert.deepEqual(Object.keys(fixtures).sort(), Object.keys(RECIPES).sort());
  for (const [kind, html] of Object.entries(fixtures)) {
    await page.route('https://college.example/**', route => route.fulfill({ contentType: 'text/html', body: html }));
    await page.goto('https://college.example/search');
    const raw = await readDom(page, 5000, readSearchPage, RECIPES[kind]);
    assert.equal(normalizeSearchPage(raw, { url: page.url(), company: 'College', kind }).jobs[0].title, 'Faculty', kind);
    if (['wgu', 'attrax', 'selectminds'].includes(kind)) assert.ok(raw.next, `${kind} next page`);
    await page.unroute('https://college.example/**');
  }
  pass('All browser recipes extract posting titles from their observed DOM shapes, including button-only and hash-pager sites');
  await page.close();

  const requests = [];
  let mode = 'complete';
  const fakeBrowser = { newContext: async options => {
    const context = await browser.newContext(options);
    const newPage = context.newPage.bind(context);
    context.newPage = async () => {
      const p = await newPage();
      await p.route('https://college.example/**', route => {
        const u = new URL(route.request().url()); requests.push(u);
        const number = u.searchParams.get('page') || '1';
        const id = mode === 'repeat' ? '1' : number;
        const next = number === '1' || mode === 'cap' ? `<a rel="next" href="?page=${Number(number)+1}">Next</a>` : '';
        const content = mode === 'broken' && number === '2' ? '<main>Please sign in</main>' : `<div id="jobs_search_results_1"><a id="link_job_title_${id}" href="/jobs/${id}">Faculty ${id}</a>${next}</div>`;
        return route.fulfill({ contentType: 'text/html', body: content });
      });
      return p;
    };
    return context;
  } };
  const opts = { url: 'https://college.example/search?faculty[]=a&faculty[]=b', company: 'College', kind: 'clinch', timeout: 1200 };
  const result = await searchBrowserJobs(opts, { browser: fakeBrowser });
  assert.equal(result.pages, 2); assert.equal(result.jobs.length, 2); assert.equal(result.complete, true);
  for (const u of requests) assert.deepEqual(u.searchParams.getAll('faculty[]'), ['a','b']);
  mode = 'repeat'; await assert.rejects(searchBrowserJobs(opts, { browser: fakeBrowser }), /repeated its postings/);
  mode = 'cap'; await assert.rejects(searchBrowserJobs({ ...opts, maxPages: 1 }, { browser: fakeBrowser }), /incomplete results were not emitted/);
  mode = 'broken'; await assert.rejects(searchBrowserJobs(opts, { browser: fakeBrowser }), /Unrecognized/);
  pass('Real browser pagination preserves filters and fails without partial output on repeated pages, caps and broken later pages');
  let georgiaReads = 0;
  const dynamicBrowser = { newContext: async options => {
    const context = await browser.newContext(options);
    const newPage = context.newPage.bind(context);
    context.newPage = async () => {
      const p = await newPage();
      await p.route('https://college.example/**', route => {
        const u = new URL(route.request().url());
        let html;
        if (u.pathname === '/georgia') {
          const n = Number(u.searchParams.get('page') || 1);
          html = `<div class="view-jobs-search">Showing 2 Jobs<div class="job-title"><a href="/job${n}">Faculty ${n}</a></div>${n === 1 ? '<div class="pager__item--next"><a href="?page=2">Next</a></div>' : ''}</div><script>if(location.search)location.href='/georgia'</script>`;
          if (++georgiaReads === 1) html = '<div class="view-jobs-search">No result found</div>';
        } else if (u.pathname === '/') {
          html = '<button id="jSearchSubmit" onclick="location.href=\'/jobs/search/123\'">Search</button>';
        } else {
          const n = u.pathname.endsWith('page2') ? 2 : 1;
          html = `<div class="jResultsActive"><div class="job_list_row"><a class="job_link" href="/jobs/${n}">Faculty ${n}</a></div><span id="jPaginateCurrPage">${n}</span><span id="jPaginateNumPages">2</span>${n === 1 ? '<a class="next" href="#page2" onclick="event.preventDefault();location.href=\'/jobs/search/123/page2\'">Next</a>' : ''}</div>`;
        }
        return route.fulfill({ contentType: 'text/html', body: html });
      });
      return p;
    };
    return context;
  } };
  assert.equal((await searchBrowserJobs({ ...opts, url: 'https://college.example/georgia', kind: 'georgia' }, { browser: dynamicBrowser })).jobs.length, 2);
  assert.equal(georgiaReads, 3);
  assert.equal((await searchBrowserJobs({ ...opts, url: 'https://college.example/', kind: 'selectminds', timeout: 4000 }, { browser: dynamicBrowser })).jobs.length, 2);
  pass('Georgia paging survives auto-submit scripts; SelectMinds starts a fresh search and advances its AJAX pager');
} catch (e) { fail(`Browser search integration: ${e.stack}`); process.exitCode = 1; }
finally { await browser?.close(); }
