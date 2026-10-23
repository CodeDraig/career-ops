#!/usr/bin/env node
// Read-only, paginated public job search for browser-rendered employer boards.
// Use through the existing local-parser provider; no login, application actions,
// profile writes or LLM calls. Recipes deliberately identify posting titles,
// not every vaguely job-shaped URL on a careers-information page.
import { chromium } from 'playwright';
import { readDom } from './browser-extract.mjs';
import { LIVENESS_CONTEXT_OPTIONS, rejectPrivateOrInvalid } from './liveness-browser.mjs';
import { isMainModule } from './lib/is-main-module.mjs';
import { validateFlags, flagValue } from './lib/cli-flags.mjs';

export const RECIPES = {
  igreentree: { container: '.table2.table-collapse', links: '.tr a[title="Click to view job description"]', row: '.tr', requisitionCells: true, startButton: 'a.btn[title="Click to view these current openings..."]', next: 'a[href*="frmPage"]', nextText: 'Next', clickNext: true, buttonNext: true, totalPattern: 'Available Positions:\\s*(\\d+)', requireTotal: true },
  jobsyn: { stopAtTotal: true, container: '#main', links: '#jobs a[href$="/job/"]', row: 'a', title: '.job-title', next: 'button[aria-label="Load more jobs"]', clickNext: true, buttonNext: true, totalPattern: '(\\d+) Jobs', requireTotal: true, emptyPattern: 'No results were found for your current search\\.' },
  neoed: { container: '[id^="jobs-list-"]', links: 'a.jobs__box', row: 'a', title: '.jobs__box__heading', location: '.jobs__box__text', jobHosts: ['www.governmentjobs.com','www.schooljobs.com'], next: '.pagination a', nextText: '❯', clickNext: true, buttonNext: true },
  brassring: { startButton: '#clearResumeJobsBtn', container: 'a[id^="Job_title"][href*="jobid="]', links: 'a[id^="Job_title"][href*="jobid="]', next: 'button[aria-label="Go to next page"]', clickNext: true, buttonNext: true, totalPattern: '(\\d+) results', requireTotal: true },
  exacthire: { container: 'a[data-testid^="jobDetailsLink"]', links: 'a[data-testid^="jobDetailsLink"]', row: 'div:has(> a[data-testid^="jobDetailsLink"])', title: 'h6', next: 'button', nextText: 'Load More Jobs', clickNext: true, buttonNext: true, totalPattern: '(\\d+) Results', requireTotal: true, stopAtTotal: true },
  brcc: { container: '#main table', links: '#main table a[href]', jobHosts: ['careers.lctcs.edu','www.governmentjobs.com'], path: '/(?:jobs/\\d+|careers/louisiana/jobs/\\d+)' },
  cunySps: { container: '.field--node-body', links: '.field--node-body li a[href]', jobHosts: ['media.sps.cuny.edu'], path: '(?:\\.pdf$|adjunct-faculty$|college-assistant)' },
  easyhr: { container: '[id$="_GridView1"]', links: '[id$="_GridView1"] a[id$="_HyperLink1"]', row: 'tr', location: '[id$="_Label4"]' },
  dayforce: { container: 'a[job-posting-id]', links: 'a[job-posting-id]', row: '.ant-card', location: '[test-id="job-location"]', next: '.ant-pagination-next', clickNext: true, buttonNext: true, paginationLabel: '.ant-pagination[aria-label]' },
  paycor: { container: 'a[href*="JobIntroduction.action?"]', links: 'a[href*="JobIntroduction.action?"]', frameHost: 'recruitingbypaycor.com' },
  paycom: { container: 'a[href*="/portal/"][href*="/jobs/"]', links: 'a[href*="/portal/"][href*="/jobs/"]', row: 'a', title: 'h2', next: 'button:has(svg[aria-label="forward arrow"])', clickNext: true, buttonNext: true, totalPattern: '(\\d+) Results', requireTotal: true },
  lctcs: { container: 'div.grid', links: 'a[href^="/jobs/"]', row: 'div.grid', title: 'div[title] p', totalPattern: 'Showing (\\d+) job', requireTotal: true },
  agmu: { container: '#Form1', links: 'a[href*="page-job-info?"]', row: 'a', title: 'h4' },
  easternFlorida: { container: 'table.responsive', links: 'table.responsive a[href*="opening-position.cfm?"]', row: 'tr', excludeRowText: 'Position Closed|No Longer Accepting' },
  paylocity: { container: '.job-listing-job-item', links: '.job-item-title a', row: '.job-listing-job-item', location: '.job-location', totalPattern: 'of (\\d+) Job Opportunities', requireTotal: true },
  kingsborough: { container: '#main-content', links: '#main-content table a[href*="cuny.jobs/"]', jobHosts: ['cuny.jobs'], path: '/job/?$' },
  bmcc: { container: '.entry-content .content-box', links: '.entry-content .content-box li a[href]', jobHosts: ['cuny.jobs', 'rfcuny.wd108.myworkdayjobs.com', 'bmccprodstroac.blob.core.windows.net'], path: '(?:/job/?$|/(?:job|details)/|/uploads/.*\\.(?:pdf|docx)$)' },
  clinch: { container: '[id^="jobs_search_results_"]', links: 'a[id^="link_job_title_"]', next: 'a[rel="next"]', row: 'article,tr', location: '.job-search-results-location,.job-component-location' },
  pageup: { container: '#search-results-content', links: '#search-results-content a.job-link', next: 'a.more-link', row: 'tr', location: '.location' },
  interviewexchange: { container: '.job-card', links: '.job-card h2 a', row: '.job-card' },
  post: { container: '#main-content', links: '#main-content a[href*="/associate-experience/career-opportunities/"]', path: '^/associate-experience/career-opportunities/[^/]+/?$' },
  excelsior: { container: 'main,#main,#content', links: 'a.stretched-link[href*="/job/"]', path: '^/job/[^/]+/?$' },
  wgu: { container: '.results-list', links: '.results-list__item-title--link', next: 'a[aria-label="Next Page"],a[rel="next"]', row: '.results-list__item', location: '.results-list__item-location', totalPattern: 'Showing [\\d-]+ of (\\d+) jobs' },
  umgc: { container: '#job-list-section', links: '#job-list-section a[href^="/job/"]', next: 'a[rel="next"],.pagination a.next' },
  hca: { container: '#job-list-inner', links: '.jobs-section__item h2 a', next: 'a[rel="next"]', row: '.jobs-section__item', location: '.neu-text--caption.neu-margin--bottom-10', totalPattern: 'of (\\d+) results' },
  seminole: { container: '.jsJob', links: '.jsJob h3', row: '.jsJob', rowUrl: 'data-url' },
  attrax: { container: '.attrax-list-widget__list', links: 'a.attrax-vacancy-tile__title', next: 'a[aria-label="Next pagination page"][href^="/"]', row: '.attrax-vacancy-tile', totalPattern: '(\\d+) results' },
  taleoBusiness: { container: '.oracletaleocwsv2-accordion', links: 'a.viewJobLink', next: 'a[rel="next"]', totalPattern: 'Positions Matched (\\d+)' },
  // Read Drupal's public AJAX view: the ordinary document can return a false
  // empty fragment, and auto-submit scripts reset pagination on navigation.
  georgia: { container: '.view-jobs-search', links: '.view-jobs-search .job-title a', next: '.view-jobs-search a[rel="next"],.pager__item--next a', row: '.ajax-dynamic-title,.views-row', agency: '.organization .group', noJavaScript: true, totalPattern: 'Showing (\\d+) Job', requireTotal: true },
  sdiFaculty: { container: '#main', links: '.job a[href*="recruiting.paylocity.com/recruiting/jobs/Details/"]', row: '.job', title: '.course-heading', jobHosts: ['recruiting.paylocity.com'], path: '^/recruiting/jobs/Details/\\d+/' },
  selectminds: { container: '.jResultsActive', links: '.jResultsActive a.job_link', row: '.job_list_row', location: '.location', next: '.jResultsActive a.next', pageToken: '.jResultsActive #jPaginateCurrPage', pageCount: '.jResultsActive #jPaginateNumPages', startSearch: '#jSearchSubmit', clickNext: true },
};

// Serialized into Chromium's isolated world by readDom.
export function readSearchPage(recipe) {
  const text = document.body?.innerText || '';
  const rows = [...document.querySelectorAll(recipe.links)].map(a => {
    const row = recipe.row ? a.closest(recipe.row) : null;
    if (recipe.requisitionCells) {
      const cells = [...(row?.querySelectorAll(':scope > .td') || [])].map(c => {
        const copy = c.cloneNode(true); copy.querySelectorAll('h6,form').forEach(n => n.remove()); return copy.textContent.trim();
      });
      const req = cells[3];
      if (!/^[A-Za-z0-9-]+$/.test(req || '')) throw new Error('Missing iGreentree requisition');
      const url = new URL('CSSPage_Referred.ASP', location.href); url.search = ''; url.searchParams.set('Req', req);
      return {title: a.innerText.trim(), url: url.href, location: cells[1] || ''};
    }
    if (recipe.excludeRowText && new RegExp(recipe.excludeRowText, 'i').test(row?.innerText || '')) return null;
    return { title: (recipe.title ? row?.querySelector(recipe.title)?.innerText : a.innerText)?.trim(), url: recipe.rowUrl ? row?.getAttribute(recipe.rowUrl) : a.href, location: recipe.location ? row?.querySelector(recipe.location)?.innerText.trim() || '' : '', description: row?.querySelector('.job-search-results-summary')?.innerText.trim() || '', ...(recipe.agency ? { agency: row?.querySelector(recipe.agency)?.textContent.trim() } : {}) };
  }).filter(Boolean);
  const next = recipe.next ? [...document.querySelectorAll(recipe.next)].find(a => (!recipe.nextText || a.innerText.trim() === recipe.nextText) && (a.getAttribute('href') || recipe.buttonNext) && !a.closest('.disabled,[aria-disabled="true"],[disabled]')) : null;
  const nextUrl = next ? (recipe.buttonNext ? location.href.split('#')[0] + '#after=' + encodeURIComponent(rows.at(-1)?.url || 'empty') : next.href) : null;
  return { rows, next: nextUrl, pageToken: recipe.pageToken ? document.querySelector(recipe.pageToken)?.textContent.trim() : null, pageCount: recipe.paginationLabel ? Number(document.querySelector(recipe.paginationLabel)?.getAttribute('aria-label')?.match(/of (\d+)/)?.[1]) : recipe.pageCount ? Number(document.querySelector(recipe.pageCount)?.textContent) : null, recognized: Boolean(document.querySelector(recipe.container)), text,
    documentUrl: location.href, readyState: document.readyState };
}

export function normalizeSearchPage(raw, { url, company, kind }) {
  const recipe = RECIPES[kind];
  if (!recipe) throw new Error(`Unknown browser search kind: ${kind}`);
  if (!raw.recognized) throw new Error(`Unrecognized ${kind} listing (blocked, login, or changed markup): ${url}`);
  const base = new URL(raw.documentUrl || url);
  const seen = new Set();
  const jobs = [];
  for (const row of raw.rows || []) {
    if (kind === 'georgia' && row.agency?.replace(/\s+/g, ' ').trim().toLowerCase() !== company.replace(/\s+/g, ' ').trim().toLowerCase()) throw new Error('Georgia posting does not match the requested employer');
    if (typeof row.url !== 'string' || !row.url.trim()) continue;
    let u;
    try { u = new URL(row.url, base); } catch { continue; }
    if ((u.origin !== base.origin && !recipe.jobHosts?.includes(u.hostname)) || rejectPrivateOrInvalid(u.href)) continue;
    if (recipe.path && !new RegExp(recipe.path).test(u.pathname)) continue;
    const title = String(row.title || '').replace(/\s+/g, ' ').trim();
    if (!title || /^(?:apply(?: now)?|read more|view details|detail)$/i.test(title)) continue;
    u.hash = '';
    if (kind === 'neoed') for (const key of ['visitor','session']) u.searchParams.delete(key);
    if (seen.has(u.href)) continue;
    seen.add(u.href);
    jobs.push({ title, url: u.href, company, location: row.location || '', ...(row.description ? { description: row.description } : {}) });
  }
  if (!jobs.length && !/no (?:matching |open |current )?(?:jobs|positions|vacancies)|0 (?:jobs|positions|results)|no results?/i.test(raw.text || '')) {
    throw new Error(`No posting titles or explicit empty-search message in ${url}`);
  }
  let next = null;
  if (raw.next) {
    const u = new URL(raw.next, base);
    if (u.origin !== base.origin || rejectPrivateOrInvalid(u.href)) throw new Error('Search pagination left the employer origin');
    // Some themes omit their existing query filters from next-page links.
    for (const key of new Set(base.searchParams.keys())) {
      if (['page','page-items','offset','start'].includes(key) || u.searchParams.has(key)) continue;
      for (const value of base.searchParams.getAll(key)) u.searchParams.append(key,value);
    }
    if (!recipe.clickNext) u.hash = '';
    next = u.href;
  }
  let total = recipe.totalPattern ? (raw.text || '').replace(/\s+/g, ' ').match(new RegExp(recipe.totalPattern, 'i'))?.[1] : null;
  if (total == null && !jobs.length && recipe.emptyPattern && new RegExp(recipe.emptyPattern).test(raw.text || '')) total = '0';
  if (kind === 'georgia' && !jobs.length && total == null) throw new Error('Georgia search returned no results without its count; empty search is unverified');
  if (recipe.requireTotal && total == null) throw new Error('Search is missing its advertised result count');
  return { jobs, next, reportedTotal: total == null ? null : Number(total) };
}

// The anonymous Drupal GET returns insert commands containing the results
// block. Render only replacement HTML; never execute AJAX commands.
async function loadGeorgiaPage(page, source, timeout) {
  const input = new URL(source), ajax = new URL('/views/ajax', input);
  ajax.search = input.search;
  for (const key of ['field_job_family','field_employee_status','field_job_level','field_schedule','field_shift']) {
    if (!ajax.searchParams.has(key)) ajax.searchParams.set(key, 'All');
  }
  if (!ajax.searchParams.has('search_api_fulltext')) ajax.searchParams.set('search_api_fulltext', '');
  // The results block has its own exposed filter names. Keep both forms in
  // sync, including when an old saved URL supplies only the primary names.
  for (const key of ['field_agency_name','field_job_family','field_employee_status','field_job_level','field_schedule','field_shift','search_api_fulltext']) {
    if (!ajax.searchParams.has(key + '_sort') && ajax.searchParams.has(key)) ajax.searchParams.set(key + '_sort', ajax.searchParams.get(key));
  }
  // Without this explicit page size, the final partial page can be returned as
  // a false empty fragment despite the view advertising more postings.
  if (!ajax.searchParams.has('page-items')) ajax.searchParams.set('page-items','20');
  for (const [key, value] of Object.entries({view_name:'jobs_search',view_display_id:'block_2',view_args:'',view_path:'/jobs-search',view_base_path:'jobs-search',pager_element:'0',_wrapper_format:'drupal_ajax',_drupal_ajax:'1'})) ajax.searchParams.set(key,value);
  const base = input.href.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
  const deadline = Date.now() + timeout;
  for (let attempt = 0; attempt < 10; attempt++) {
    if (Date.now() >= deadline) break;
    const remaining = () => Math.max(1,deadline-Date.now());
    const response = await page.request.get(ajax.href, {timeout:remaining(),maxRedirects:0,headers:{Accept:'application/json','X-Requested-With':'XMLHttpRequest','Cache-Control':'no-cache'}});
    if (!response.ok() || new URL(response.url()).origin !== input.origin) throw new Error('Georgia public search request failed');
    const commands = await response.json();
    const views = Array.isArray(commands) ? commands.filter(c => c.command === 'insert' && c.method === 'replaceWith' && typeof c.data === 'string' && c.data.includes('view-jobs-search')) : [];
    if (views.length !== 1) throw new Error('Georgia public search returned no unambiguous results view');
    await page.setContent(`<base href="${base}">${views[0].data}`, {waitUntil:'domcontentloaded',timeout:remaining()});
    const raw = await readDom(page, remaining(), readSearchPage, RECIPES.georgia);
    const total = raw.text.replace(/\s+/g,' ').match(/Showing (\d+) Job/i)?.[1];
    if (total !== undefined && (raw.rows.length || total === '0')) return;
    // Repeated live reads of the same page alternate between real results and
    // HTTP-200 empty fragments with no count. Retry only that unverified shape,
    // within the caller's time budget; never emit it as a zero or partial list.
    if (Date.now() >= deadline || attempt === 9) break;
    await page.waitForTimeout(Math.min(1000,remaining()));
    ajax.searchParams.set('_career_ops_read',String(Date.now()));
  }
  throw new Error('Georgia search returned no results without its count; empty search is unverified');
}

export async function searchBrowserJobs({ url, company, kind, maxPages = 100, timeout = 30000 }, { browser: suppliedBrowser } = {}) {
  if (!RECIPES[kind]) throw new Error(`Unknown browser search kind: ${kind}`);
  if (typeof company !== 'string' || !company.trim()) throw new Error('A company name is required');
  if (!Number.isInteger(maxPages) || maxPages < 1 || maxPages > 200) throw new Error('maxPages must be 1..200');
  if (rejectPrivateOrInvalid(url)) throw new Error('Expected a public HTTP(S) careers URL');
  const recipe = RECIPES[kind];
  const browser = suppliedBrowser || await chromium.launch({ headless: true });
  const context = await browser.newContext({ ...LIVENESS_CONTEXT_OPTIONS, javaScriptEnabled: !RECIPES[kind].noJavaScript });
  try {
    await context.route('**/*', route => rejectPrivateOrInvalid(route.request().url()) ? route.abort('blockedbyclient') : route.continue());
    const page = await context.newPage();
    const jobs = [], visited = new Set(), seen = new Set();
    let reportedTotal = null;
    let next = url;
    let previousSignature = null;
    for (let n = 1; n <= maxPages; n++) {
      if (visited.has(next)) throw new Error('Job search pagination repeated a page');
      visited.add(next);
      if (n > 1 && recipe.clickNext) {
        await (recipe.nextText ? page.locator(recipe.next).filter({ hasText: recipe.nextText }) : page.locator(recipe.next)).first().click({ timeout });
      } else if (kind === 'georgia') {
        await loadGeorgiaPage(page, next, timeout);
      } else {
        const response = await page.goto(next, { waitUntil: 'domcontentloaded', timeout, ...(n > 1 ? { referer: page.url() } : {}) });
        // A challenge response may navigate to the public page after its own
        // scripts finish. Give it the same bounded readiness check; never call
        // a challenge an empty search or emit the preceding partial pages.
        if (response && response.status() >= 400 && response.status() !== 403) throw new Error(`Job search HTTP ${response.status()}: ${next}`);
      }
      if (n === 1 && recipe.startButton) await page.locator(recipe.startButton).click({ timeout });
      if (n === 1 && recipe.startSearch) {
        // Search IDs are session-specific; never save/reuse a historical ID.
        // Some themes bind the button after DOMContentLoaded. Repeat only this
        // read-only Search action until the results route appears.
        const searchDeadline = Date.now() + timeout;
        while (!/\/jobs\/search\/\d+/.test(new URL(page.url()).pathname)) {
          if (Date.now() >= searchDeadline) throw new Error('Public search did not open a results page');
          await page.locator(recipe.startSearch).click({ timeout });
          await page.waitForTimeout(1000);
        }
      }
      let raw;
      const deadline = Date.now() + timeout;
      do {
        await page.waitForTimeout(500);
        const frameUrl = recipe.frameHost ? page.frames().find(f => { try { return new URL(f.url()).hostname === recipe.frameHost; } catch { return false; } })?.url() : undefined;
        raw = await readDom(page, Math.max(1,deadline-Date.now()), readSearchPage, RECIPES[kind], frameUrl);
        if (kind === 'georgia') raw.documentUrl = next;
        if ((!recipe.pageToken || raw.pageToken === String(n)) && (!recipe.buttonNext || JSON.stringify(raw.rows.map(r => r.url)) !== previousSignature) && (!recipe.requireTotal || new RegExp(recipe.totalPattern, 'i').test(raw.text.replace(/\s+/g, ' ')) || (recipe.emptyPattern && new RegExp(recipe.emptyPattern).test(raw.text))) && raw.recognized && (raw.rows.length || /no (?:matching |open |current )?(?:jobs|positions|vacancies)|0 (?:jobs|positions|results)|no results?/i.test(raw.text))) break;
      } while (Date.now() < deadline);
      if (rejectPrivateOrInvalid(raw.documentUrl)) throw new Error('Blocked final job search URL');
      if (recipe.pageToken && raw.pageToken !== String(n)) throw new Error(`Search did not advance to page ${n} (reported ${raw.pageToken})`);
      previousSignature = JSON.stringify(raw.rows.map(r => r.url));
      const parsed = normalizeSearchPage(raw, { url: next, company, kind });
      if (kind === 'georgia' && reportedTotal !== null && parsed.reportedTotal !== reportedTotal) throw new Error('Georgia search total changed during pagination');
      if (parsed.reportedTotal !== null) reportedTotal = parsed.reportedTotal;
      let fresh = 0;
      for (const job of parsed.jobs) if (!seen.has(job.url)) { seen.add(job.url); jobs.push(job); fresh++; }
      if (n > 1 && parsed.jobs.length && !fresh) throw new Error('Job search pagination repeated its postings');
      if (!parsed.next || (recipe.stopAtTotal && reportedTotal !== null && jobs.length === reportedTotal)) {
        if ((reportedTotal !== null && (jobs.length < reportedTotal || (kind === 'georgia' && jobs.length !== reportedTotal))) || raw.pageCount > n) throw new Error('Search ended without its advertised total; incomplete results were not emitted');
        return { jobs, pages: n, complete: true, source: url, ...(reportedTotal === null ? {} : { reportedTotal }) };
      }
      next = parsed.next;
    }
    throw new Error(`Job search exceeded maxPages=${maxPages}; incomplete results were not emitted`);
  } finally { await context.close(); if (!suppliedBrowser) await browser.close(); }
}

async function main() {
  const args = process.argv.slice(2);
  const usage = 'node browser-job-search.mjs --url URL --company NAME --kind KIND [--max-pages 100]';
  validateFlags(args, ['--url','--company','--kind','--max-pages','--help','-h'], usage, { valueFlags: ['--url','--company','--kind','--max-pages'], requireOperand: true });
  try {
    const result = await searchBrowserJobs({ url: flagValue(args,'--url'), company: flagValue(args,'--company'), kind: flagValue(args,'--kind'), maxPages: Number(flagValue(args,'--max-pages') || 100) });
    process.stdout.write(JSON.stringify(result));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
if (isMainModule(import.meta.url)) await main();
