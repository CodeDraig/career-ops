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
  // Drupal's auto-submit script resets ?page on navigation. Its server-rendered
  // list already contains the results and pager; leave that script disabled.
  georgia: { container: '.view-jobs-search', links: '.view-jobs-search .job-title a', next: '.pager__item--next a', row: '.views-row', noJavaScript: true, totalPattern: 'Showing (\\d+) Job' },
  sdiFaculty: { container: '#main', links: '.job a[href*="recruiting.paylocity.com/recruiting/jobs/Details/"]', row: '.job', title: '.course-heading', jobHosts: ['recruiting.paylocity.com'], path: '^/recruiting/jobs/Details/\\d+/' },
  selectminds: { container: '.jResultsActive', links: '.jResultsActive a.job_link', row: '.job_list_row', location: '.location', next: '.jResultsActive a.next', pageToken: '.jResultsActive #jPaginateCurrPage', pageCount: '.jResultsActive #jPaginateNumPages', startSearch: '#jSearchSubmit', clickNext: true },
};

// Serialized into Chromium's isolated world by readDom.
export function readSearchPage(recipe) {
  const text = document.body?.innerText || '';
  const rows = [...document.querySelectorAll(recipe.links)].map(a => {
    const row = recipe.row ? a.closest(recipe.row) : null;
    return { title: (recipe.title ? row?.querySelector(recipe.title)?.innerText : a.innerText)?.trim(), url: recipe.rowUrl ? row?.getAttribute(recipe.rowUrl) : a.href, location: recipe.location ? row?.querySelector(recipe.location)?.innerText.trim() || '' : '', description: row?.querySelector('.job-search-results-summary')?.innerText.trim() || '' };
  });
  const next = recipe.next ? [...document.querySelectorAll(recipe.next)].find(a => a.getAttribute('href') && !a.closest('.disabled,[aria-disabled="true"]'))?.href : null;
  return { rows, next, pageToken: recipe.pageToken ? document.querySelector(recipe.pageToken)?.textContent.trim() : null, pageCount: recipe.pageCount ? Number(document.querySelector(recipe.pageCount)?.textContent) : null, recognized: Boolean(document.querySelector(recipe.container)), text,
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
    if (typeof row.url !== 'string' || !row.url.trim()) continue;
    let u;
    try { u = new URL(row.url, base); } catch { continue; }
    if ((u.origin !== base.origin && !recipe.jobHosts?.includes(u.hostname)) || rejectPrivateOrInvalid(u.href)) continue;
    if (recipe.path && !new RegExp(recipe.path).test(u.pathname)) continue;
    const title = String(row.title || '').replace(/\s+/g, ' ').trim();
    if (!title || /^(?:apply(?: now)?|read more|view details|detail)$/i.test(title)) continue;
    u.hash = '';
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
  const total = recipe.totalPattern ? (raw.text || '').replace(/\s+/g, ' ').match(new RegExp(recipe.totalPattern, 'i'))?.[1] : null;
  if (kind === 'georgia' && !jobs.length && total == null) throw new Error('Georgia search returned no results without its count; empty search is unverified');
  return { jobs, next, reportedTotal: total == null ? null : Number(total) };
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
    for (let n = 1; n <= maxPages; n++) {
      if (visited.has(next)) throw new Error('Job search pagination repeated a page');
      visited.add(next);
      if (n > 1 && recipe.clickNext) {
        await page.locator(recipe.next).first().click({ timeout });
      } else {
        const response = await page.goto(next, { waitUntil: 'domcontentloaded', timeout, ...(n > 1 ? { referer: page.url() } : {}) });
        // A challenge response may navigate to the public page after its own
        // scripts finish. Give it the same bounded readiness check; never call
        // a challenge an empty search or emit the preceding partial pages.
        if (response && response.status() >= 400 && response.status() !== 403) throw new Error(`Job search HTTP ${response.status()}: ${next}`);
      }
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
        raw = await readDom(page, Math.max(1,deadline-Date.now()), readSearchPage, RECIPES[kind]);
        if ((!recipe.clickNext || raw.pageToken === String(n)) && raw.recognized && (raw.rows.length || /no (?:matching |open |current )?(?:jobs|positions|vacancies)|0 (?:jobs|positions|results)|no results?/i.test(raw.text))) break;
      } while (Date.now() < deadline);
      // This Drupal board intermittently serves an HTTP-200 "No result found"
      // fragment without its result count, even for a populated agency. Retry
      // that exact read twice; never turn the fragment into a verified zero.
      if (kind === 'georgia') {
        for (let retry = 0; retry < 2 && !raw.rows.length && !/Showing\s+0\s+Job/i.test(raw.text); retry++) {
          await page.waitForTimeout(500);
          await page.goto(next, { waitUntil: 'domcontentloaded', timeout });
          raw = await readDom(page, timeout, readSearchPage, recipe);
        }
      }
      if (rejectPrivateOrInvalid(raw.documentUrl)) throw new Error('Blocked final job search URL');
      if (recipe.clickNext && raw.pageToken !== String(n)) throw new Error(`Search did not advance to page ${n} (reported ${raw.pageToken})`);
      const parsed = normalizeSearchPage(raw, { url: next, company, kind });
      if (parsed.reportedTotal !== null) reportedTotal = parsed.reportedTotal;
      let fresh = 0;
      for (const job of parsed.jobs) if (!seen.has(job.url)) { seen.add(job.url); jobs.push(job); fresh++; }
      if (n > 1 && parsed.jobs.length && !fresh) throw new Error('Job search pagination repeated its postings');
      if (!parsed.next) {
        if ((reportedTotal !== null && jobs.length < reportedTotal) || raw.pageCount > n) throw new Error('Search ended before its advertised total; incomplete results were not emitted');
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
