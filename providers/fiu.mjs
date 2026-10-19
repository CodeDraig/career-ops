// @ts-check
/** @typedef {import('./_types.js').Provider} Provider */
// Florida International University's public employer feed; tracked_companies.
import { htmlToText } from './_html-to-text.mjs';
const URL = 'https://search.careers.fiu.edu/api/jobs';
export function parseFiuJobs(payload, company) {
  if (!Array.isArray(payload?.JOB_POSTINGS)) throw new Error('fiu: unrecognized job feed');
  return payload.JOB_POSTINGS.flatMap(row => {
    if (!row?.POSTING_TITLE || !row.URL) return [];
    let url;
    try { url = new globalThis.URL(row.URL); } catch { return []; }
    if (url.protocol !== 'https:' || url.hostname !== 'pslinks.fiu.edu' || !/^\d+$/.test(String(row.JOB_OPENING_ID))) return [];
    return [{ title: String(row.POSTING_TITLE), url: url.href, company, location: String(row.LOCATION || ''),
      requisitionId: String(row.JOB_OPENING_ID), description: htmlToText(row.DESCRIPTION || '') }];
  });
}
/** @type {Provider} */
export default {
  id: 'fiu',
  detect(entry) {
    return entry?.provider === 'fiu' ? { url: URL } : null;
  },
  async fetch(entry, ctx) { return parseFiuJobs(await ctx.fetchJson(URL, { redirect: 'error' }), entry.name); },
};
