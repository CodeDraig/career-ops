// Public AgileHR career portal's complete getall response.
import { htmlToText } from './_html-to-text.mjs';
export function resolveAgilehr(entry){try{const u=new URL(entry.careers_url);return u.protocol==='https:'&&/^[a-z0-9-]+\.agilehr\.com$/.test(u.hostname)&&/^\/careers\/?$/.test(u.pathname)?u.origin:null;}catch{return null;}}
export function parseAgilehr(data,origin,company){
  if(data?.Success!==true||!Array.isArray(data.ResultList))throw new Error('agilehr: malformed listing response');
  const seen=new Set();return data.ResultList.map(row=>{
    if(!Number.isInteger(row.Id)||row.Id<1||!row.Title?.trim())throw new Error('agilehr: missing posting identity');
    if(seen.has(row.Id))throw new Error('agilehr: repeated posting');seen.add(row.Id);
    return {title:row.Title.trim(),url:`${origin}/careers/JobDetail?RequisitionId=${row.Id}&SourceId=0`,company,location:[row.City,row.State].filter(Boolean).join(', '),description:htmlToText(row.Advertisement||row.Description||'')};
  });
}
export default {id:'agilehr',detect(entry){const origin=resolveAgilehr(entry);return origin?{url:entry.careers_url}:null;},async fetch(entry,ctx){const origin=resolveAgilehr(entry);if(!origin)throw new Error('agilehr: expected public careers portal');return parseAgilehr(await ctx.fetchJson(`${origin}/public/api/careerportal/getall?sourceId=0`,{redirect:'error'}),origin,entry.name);}};
