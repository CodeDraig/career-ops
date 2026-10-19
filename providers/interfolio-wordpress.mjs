// UWA publishes its complete Interfolio opportunity list through its own public
// WordPress integration. This is not Interfolio's authenticated applicant API.
export function parseInterfolioOpportunities(data, company) {
  if (!Array.isArray(data)) throw new Error('interfolio-wordpress: expected opportunity array');
  const seen=new Set();
  return data.map(row=>{
    const url=new URL(row.position_slug);
    if(url.protocol!=='https:' || url.hostname!=='apply.interfolio.com' || !/^\/\d+\/?$/.test(url.pathname) || !row.opportunity?.trim()) throw new Error('interfolio-wordpress: malformed opportunity');
    if(seen.has(url.href))return null;
    seen.add(url.href);
    return {title:row.opportunity.trim(),url:url.href,company,location:'',description:[row.job_type,row.department].filter(Boolean).join(' — ')};
  }).filter(Boolean);
}
function accepts(entry){try{const u=new URL(entry.careers_url);return u.protocol==='https:'&&['www.uwa.edu','uwa.edu'].includes(u.hostname)&&/employment|opportunities/.test(u.pathname);}catch{return false;}}
export default {
  id:'interfolio-wordpress',detect(entry){return accepts(entry)?{url:entry.careers_url}:null;},
  async fetch(entry,ctx){
    if(!accepts(entry))throw new Error('interfolio-wordpress: unsupported employer endpoint');
    return parseInterfolioOpportunities(await ctx.fetchJson('https://www.uwa.edu/wp-json/interfolio/v1/opportunities?search=&job_type=&sort=&order=asc',{redirect:'error'}),entry.name);
  }
};
