#!/usr/bin/env node
// Read-only ADP MyJobs search using a fresh anonymous browser session. The
// public site's tenant token stays in memory and is never printed or saved.
import {chromium} from 'playwright';
import {htmlToText} from './providers/_html-to-text.mjs';
import {isMainModule} from './lib/is-main-module.mjs';
import {validateFlags,flagValue} from './lib/cli-flags.mjs';
const API='https://my.adp.com/myadp_prefix/mycareer/public/staffing/v1/job-requisitions/apply-custom-filters';
export function resolveMyjobs(raw){
  const u=new URL(raw),m=u.pathname.match(/^\/([a-zA-Z0-9_-]+)(?:\/cx(?:\/job-listing)?\/?)?$/);
  if(u.protocol!=='https:'||u.hostname!=='myjobs.adp.com'||!m)throw new Error('Expected a public ADP MyJobs employer URL');
  return {tenant:m[1],url:`${u.origin}/${m[1]}/cx/job-listing`};
}
export function parseMyjobs(data,tenant,company){
  if(!Number.isInteger(data?.count)||data.count<0||!Array.isArray(data.jobRequisitions))throw new Error('ADP MyJobs returned an unrecognized listing');
  const jobs=data.jobRequisitions.map(row=>{
    if(!/^\d+$/.test(String(row.reqId||''))||!(row.publishedJobTitle||row.jobTitle)?.trim())throw new Error('ADP MyJobs posting missing identity');
    if(Array.isArray(row.careerSiteDomains)&&!row.careerSiteDomains.includes(tenant))throw new Error('ADP MyJobs posting belongs to another career site');
    const location=(row.requisitionLocations||[]).map(l=>[l.address?.cityName,l.address?.countrySubdivisionLevel1?.longName,l.address?.country?.longName].filter(Boolean).join(', ')).join(' / ');
    return {title:(row.publishedJobTitle||row.jobTitle).trim(),url:`https://myjobs.adp.com/${tenant}/cx/job-details?reqId=${row.reqId}`,company,location,description:htmlToText(row.jobDescription||'')};
  });return {jobs,total:data.count};
}
export async function searchMyjobs({url,company,maxPages=200}){
  if(!Number.isInteger(maxPages)||maxPages<1||maxPages>200)throw new Error('maxPages must be 1..200');
  const cfg=resolveMyjobs(url);if(!company?.trim())throw new Error('Company is required');
  const browser=await chromium.launch(),context=await browser.newContext();
  try{
    const page=await context.newPage();
    const responsePromise=page.waitForResponse(r=>r.url().split('?')[0]===API,{timeout:45000});
    // Attach rejection handling immediately while navigation is in progress.
    responsePromise.catch(()=>{});
    await page.goto(cfg.url,{waitUntil:'domcontentloaded',timeout:30000});
    const initial=await responsePromise;
    if(!initial.ok())throw new Error(`ADP MyJobs search HTTP ${initial.status()}`);
    const observed=initial.request().headers(),headers={};
    for(const key of ['myjobstoken','rolecode','referer'])if(observed[key])headers[key]=observed[key];
    const apiUrl=new URL(initial.url());
    const jobs=[],seen=new Set();let offset=0,data=await initial.json();
    for(let n=1;n<=maxPages;n++){
      const parsed=parseMyjobs(data,cfg.tenant,company);let fresh=0;
      for(const job of parsed.jobs)if(!seen.has(job.url)){seen.add(job.url);jobs.push(job);fresh++;}
      if(jobs.length===parsed.total)return {jobs,pages:n,complete:true,reportedTotal:parsed.total,source:cfg.url};
      if(!fresh||jobs.length>parsed.total)throw new Error('ADP MyJobs pagination repeated or ended before its total');
      offset+=parsed.jobs.length;apiUrl.searchParams.set('$skip',String(offset));
      const response=await context.request.get(apiUrl.href,{headers,maxRedirects:0,timeout:30000});
      if(!response.ok())throw new Error(`ADP MyJobs search HTTP ${response.status()}`);
      data=await response.json();
    }
    throw new Error('ADP MyJobs exceeded page limit; incomplete results were not emitted');
  }finally{await context.close();await browser.close();}
}
if(isMainModule(import.meta.url)){
  const args=process.argv.slice(2);validateFlags(args,['--url','--company','--help','-h'],'node adp-myjobs-search.mjs --url URL --company NAME',{valueFlags:['--url','--company'],requireOperand:true});
  try{console.log(JSON.stringify(await searchMyjobs({url:flagValue(args,'--url'),company:flagValue(args,'--company')})));}catch(e){console.error(e.message);process.exitCode=1;}
}
