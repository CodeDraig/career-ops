// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
// Public isolved Hire employer boards; tracked_companies. The page publishes
// its domain id, and /core/jobs/{id} returns the complete public jobs array.
import { htmlToText } from './_html-to-text.mjs';
function board(entry) {
  try { const u = new URL(entry.careers_url); return u.protocol === 'https:' && /^[a-z0-9-]+\.isolvedhire\.com$/i.test(u.hostname) && !u.username && !u.password && !u.port ? u.origin : null; } catch { return null; }
}
export function parseIsolvedJobs(json, origin, company) {
  if (json?.success !== true || !Array.isArray(json?.data?.jobs)) throw new Error('isolvedhire: unrecognized public jobs feed');
  if (Number.isFinite(Number(json.data.jobCount)) && Number(json.data.jobCount) > json.data.jobs.length) throw new Error('isolvedhire: incomplete jobs feed');
  return json.data.jobs.flatMap(row => {
    if (!row?.title || !row.jobUrl) return [];
    let u; try { u = new URL(row.jobUrl); } catch { return []; }
    if (u.origin !== origin || !/^\/jobs\/\d+(?:[/.]|$)/.test(u.pathname)) return [];
    return [{ title: htmlToText(row.title), url: u.href, company, location: [row.city,row.stateName,row.iso3].filter(Boolean).join(', '), externalId: String(row.id) }];
  });
}
/** @type {Provider} */
export default {
  id: 'isolvedhire',
  detect(entry) { const origin = board(entry); return origin ? { url: origin + '/jobs/' } : null; },
  async fetch(entry, ctx) {
    const origin = board(entry); if (!origin) throw new Error('isolvedhire: expected an HTTPS employer.isolvedhire.com URL');
    const html = await ctx.fetchText(origin + '/jobs/', { redirect: 'error' });
    const id = html.match(/"domain_id"\s*:\s*"?(\d+)/)?.[1];
    if (!id) throw new Error('isolvedhire: public domain id missing');
    const u = new URL(`/core/jobs/${id}`, origin);
    u.searchParams.set('getParams', JSON.stringify({ isInternal: 0 }));
    return parseIsolvedJobs(await ctx.fetchJson(u.href, { redirect: 'error' }), origin, entry.name);
  },
};
