// Public embedded ClearCompany career feed. The listing API returns all rows
// when no paging/filter arguments are supplied; verify that against its count.
import { htmlToText } from './_html-to-text.mjs';
export function parseClearcompany(data, entry) {
  if (!Array.isArray(data?.results) || !Number.isInteger(data.totalCount) || data.totalCount < 0 || data.results.length !== data.totalCount) throw new Error('clearcompany: incomplete or malformed listing');
  const seen=new Set();
  const jobs=data.results.map(row=>{
    if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(row.id||'') || !row.positionTitle?.trim()) throw new Error('clearcompany: missing posting identity');
    if(seen.has(row.id))throw new Error('clearcompany: repeated posting');seen.add(row.id);
    const url=new URL(entry.careers_url);url.searchParams.set('jobId',row.id);
    return {title:row.positionTitle.trim(),url:url.href,company:entry.name,location:row.location||'',description:htmlToText(row.description||'')};
  });
  return jobs;
}
export default {
  id:'clearcompany',
  async fetch(entry,ctx){
    if(!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(entry.clearcompany_id||''))throw new Error('clearcompany: clearcompany_id must be the public employer UUID');
    const u=new URL(entry.careers_url);if(u.protocol!=='https:')throw new Error('clearcompany: expected HTTPS careers page');
    return parseClearcompany(await ctx.fetchJson(`https://careers-api.clearcompany.com/v1/${entry.clearcompany_id}`,{redirect:'error'}),entry);
  }
};
