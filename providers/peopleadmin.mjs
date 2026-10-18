// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
// PeopleAdmin public listings, tracked_companies: one institution/system per entry.
// Vendor hosts are auto-detected. Branded hosts require provider: peopleadmin;
// /postings alone is not a unique vendor signature. No login or detail fan-out.
import { decodeEntities } from './_html-entities.mjs';
import { htmlToText } from './_html-to-text.mjs';
import { fetchTextWithRetry, sleep } from './_http.mjs';

const DEFAULT_MAX_PAGES = 50;
const MAX_PAGES_CAP = 200;

function target(entry) {
  const raw = entry.api || entry.careers_url;
  if (typeof raw !== 'string') return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
    if (entry.provider !== 'peopleadmin' && !/^[a-z0-9-]+\.peopleadmin\.com$/i.test(u.hostname)) return null;
    // Listing filters are intentional; a posting permalink resolves to the full board.
    const search = u.pathname === '/postings/search' ? u.search : '';
    return new URL(`/postings/search${search}`, u.origin);
  } catch { return null; }
}

/** Parse the public search_results envelope; column order differs by institution. */
export function parsePeopleadminListing(html, listingUrl, company) {
  const body = String(html ?? '').replace(/<!--[\s\S]*?-->/g, '');
  if (!/\bid=["']search_results["']/i.test(body)) {
    throw new Error('peopleadmin: missing search_results container (login, challenge, or changed markup)');
  }
  const jobs = [];
  const seen = new Set();
  // Titles live in headings, whereas View Details and Bookmark repeat the URL.
  for (const heading of body.matchAll(/<h[234]\b[^>]*>([\s\S]*?)<\/h[234]>/gi)) {
    const link = heading[1].match(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    let u;
    try { u = new URL(decodeEntities(link[1]), listingUrl); } catch { continue; }
    if (u.origin !== new URL(listingUrl).origin || !/^\/postings\/\d+\/?$/.test(u.pathname)) continue;
    const title = htmlToText(link[2]);
    const url = `${u.origin}${u.pathname.replace(/\/$/, '')}`;
    if (!title || seen.has(url)) continue;
    seen.add(url);
    jobs.push({ title, url, company, location: '' });
  }
  if (!jobs.length && /href=["'][^"']*\/postings\/\d+/i.test(body)) {
    throw new Error('peopleadmin: posting links present but no titles parsed');
  }
  // Only use the next-page signal; never follow an arbitrary scraped URL.
  const hasMore = /<a\b[^>]*\brel=["']next["']/i.test(body) || /<a\b[^>]*\bclass=["'][^"']*\bnext_page\b/i.test(body);
  return { jobs, hasMore };
}

/** @type {Provider} */
export default {
  id: 'peopleadmin',
  detect(entry) {
    const u = target(entry);
    return u ? { url: u.href } : null;
  },
  async fetch(entry, ctx) {
    const base = target(entry);
    if (!base) throw new Error('peopleadmin: expected an HTTPS PeopleAdmin host or explicit provider: peopleadmin for a branded host');
    const cap = Math.min(MAX_PAGES_CAP, Number.isInteger(entry.max_pages) && entry.max_pages > 0 ? entry.max_pages : DEFAULT_MAX_PAGES);
    const probe = Number.isInteger(ctx.maxPages) && ctx.maxPages > 0;
    const pages = probe ? Math.min(cap, ctx.maxPages) : cap;
    const jobs = [];
    const seen = new Set();
    for (let page = 1; page <= pages; page++) {
      if (page > 1) await sleep(250, ctx);
      const url = new URL(base);
      url.searchParams.set('page', String(page));
      const html = await fetchTextWithRetry(ctx, url.href, { redirect: 'error' });
      const parsed = parsePeopleadminListing(html, url.href, entry.name);
      let fresh = 0;
      for (const job of parsed.jobs) {
        if (seen.has(job.url)) continue;
        seen.add(job.url); jobs.push(job); fresh++;
      }
      if (!parsed.hasMore) return jobs;
      if (!fresh) throw new Error(`peopleadmin: pagination did not advance at page ${page}`);
      if (page === cap && !probe) console.error(`peopleadmin: ${entry.name} truncated at max_pages=${cap}; raise max_pages for more`);
    }
    return jobs;
  },
};
