// Public SilkRoad listing pages. Follow the server's pager, preserving filters.
import { htmlToText } from './_html-to-text.mjs';
import { decodeEntities } from './_html-entities.mjs';
export function resolveSilkroad(entry) {
  try {
    const u = new URL(entry.careers_url);
    if (u.protocol !== 'https:' || u.hostname !== 'jobs.silkroad.com' || !/^\/[^/]+\/[^/]+\/?$/.test(u.pathname)) return null;
    u.hash = ''; return u;
  } catch { return null; }
}
export function parseSilkroad(html, url, company) {
  const base = new URL(url), jobs = [];
  for (const m of html.matchAll(/<a\b[^>]*id="Jobs_PagedJobList_Job-\d+"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
    const u = new URL(decodeEntities(m[1]), base);
    if (u.origin !== base.origin || !u.pathname.startsWith(base.pathname.replace(/\/$/,'') + '/jobs/')) throw new Error('silkroad: posting left employer board');
    const title = htmlToText(m[2].match(/<div[^>]*class="sr-panel__title"[^>]*>([\s\S]*?)<\/div>/)?.[1] || '').trim();
    if (!title) throw new Error('silkroad: posting missing title');
    const location = htmlToText(m[2].match(/<div[^>]*class="sr-panel__location"[^>]*>([\s\S]*?)<\/div>/)?.[1] || '').trim();
    jobs.push({title,url:u.href,company,location});
  }
  const pager = html.match(/id="Jobs_PagedJobList_CurrentPageText"[^>]*>\s*Page\s+(\d+)\s+of\s+(\d+)/i);
  if (!jobs.length && !/no (?:jobs|results|positions|opportunities) (?:found|available|match)/i.test(htmlToText(html))) throw new Error('silkroad: unrecognized or blocked listing');
  if (jobs.length && !pager) throw new Error('silkroad: missing pagination evidence');
  const page = pager ? Number(pager[1]) : 1, pages = pager ? Number(pager[2]) : 1;
  const button = html.match(/<button[^>]*id="Jobs_PagedJobList_NextLink"[^>]*>/)?.[0];
  const href = button && !/\sdisabled(?:\s|>|=)/.test(button) ? button.match(/data-href="([^"]+)"/)?.[1] : null;
  if (page < pages && !href) throw new Error('silkroad: missing next page');
  let next = null;
  if (page < pages) {
    const n = new URL(decodeEntities(href),base);
    if (n.origin !== base.origin || n.pathname !== base.pathname) throw new Error('silkroad: pagination left employer board');
    for (const key of new Set(base.searchParams.keys())) if (key !== 'page' && !n.searchParams.has(key)) for (const val of base.searchParams.getAll(key)) n.searchParams.append(key,val);
    next = n.href;
  }
  return { jobs, next, page, pages };
}
export default {
  id:'silkroad', detect(entry) { const u=resolveSilkroad(entry); return u ? {url:u.href} : null; },
  async fetch(entry,ctx) {
    let url=resolveSilkroad(entry)?.href;
    if (!url) throw new Error('silkroad: expected public employer listing URL');
    const jobs=[], seen=new Set();const limit=Number(entry.max_pages || 200);
    for(let n=1;n<=limit;n++) {
      const parsed=parseSilkroad(await ctx.fetchText(url,{redirect:'error'}),url,entry.name);
      if(parsed.page!==n) throw new Error('silkroad: pagination repeated or skipped a page');
      let fresh=0;for(const job of parsed.jobs) if(!seen.has(job.url)){seen.add(job.url);jobs.push(job);fresh++;}
      if(n>1 && !fresh) throw new Error('silkroad: pagination repeated postings');
      if(!parsed.next)return jobs;
      url=parsed.next;
    }
    throw new Error('silkroad: pagination limit reached; incomplete results');
  }
};
