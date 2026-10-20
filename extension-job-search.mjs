#!/usr/bin/env node
// Public college searches using Browser Harness content-script snapshots only.
import {execFile} from 'node:child_process';
import {readFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {browserHarnessBinary} from './lib/browser-harness/runner.mjs';
import {withPipelineLock} from './pipeline-lock.mjs';
import {isMainModule} from './lib/is-main-module.mjs';
import {validateFlags,flagValue} from './lib/cli-flags.mjs';

export function validateExtensionSearch({url,company,kind,maxPages=100}) {
  const u=new URL(url);
  if(u.protocol!=='https:'||u.username||u.password||u.port||!company?.trim())throw new Error('Public HTTPS employer URL and company required');
  if(kind==='hca') {
    if(u.hostname!=='careers.hcahealthcare.com'||!/^\/search\/galen-college-of-nursing\/jobs(?:\/in)?\/?$/.test(u.pathname)||u.search)throw new Error('Expected unfiltered Galen employer search');
  } else if(kind==='interviewexchange') {
    if(!/^[a-z0-9-]+\.interviewexchange\.com$/.test(u.hostname)||!/^\/static\/clients\/[A-Za-z0-9]+\/index\.jsp$/.test(u.pathname)||u.search)throw new Error('Expected InterviewExchange public all-jobs page');
  } else throw new Error('Unsupported extension search kind');
  if(!Number.isInteger(maxPages)||maxPages<1||maxPages>100)throw new Error('maxPages must be 1..100');
}

export function normalizeExtensionPages(pages,options) {
  validateExtensionSearch(options);
  const {url,company,kind}=options,origin=new URL(url).origin,jobs=[],seen=new Set();let total=null;
  if(!Array.isArray(pages)||!pages.length)throw new Error('No search snapshots');
  for(const [i,page] of pages.entries()) {
    const current=new URL(page.url),text=String(page.text||'');
    if(current.origin!==origin||/sorry, you have been blocked|resource you requested is not authorized|just a moment/i.test(text))throw new Error('Blocked or foreign employer search');
    if(kind==='hca' && !/^\/search\/galen-college-of-nursing\/jobs(?:\/in)?\/?$/.test(current.pathname))throw new Error('Search left Galen scope');
    if(kind==='interviewexchange' && current.pathname!==new URL(url).pathname)throw new Error('Search left employer listing');
    const found=new Map();
    for(const link of page.links||[]) {
      const u=new URL(link.url,page.url),title=String(link.text||'').replace(/\s+/g,' ').trim();
      if(u.origin!==origin||!title)continue;
      if(kind==='hca' ? !/^\/jobs\/\d+-/.test(u.pathname)||!/(?:^| > )h2 > a$/.test(link.selector||'') : u.pathname!=='/jobofferdetails.jsp'||!/^\d+$/.test(u.searchParams.get('JOBID')||'')||!/(?:^| > )h[26] > a$/.test(link.selector||''))continue;
      u.hash='';
      if(kind==='interviewexchange'){const id=u.searchParams.get('JOBID');u.search='';u.searchParams.set('JOBID',id);}
      let location='';
      if(kind==='hca') {
        const lines=text.split(/\r?\n/).map(l=>l.trim()),at=lines.indexOf(title);
        const candidate=at>=0?lines[at+2]:'';
        if(candidate && /, [A-Z]{2}, United States$/.test(candidate))location=candidate;
      }
      found.set(u.href,{title,url:u.href,company,location});
    }
    if(!found.size)throw new Error('No recognized posting titles; empty search is unverified');
    if(kind==='hca') {
      const match=text.replace(/\s+/g,' ').match(/Showing (\d+)-(\d+) of (\d+) results/);
      if(!match||Number(match[1])!==jobs.length+1||Number(match[2])-Number(match[1])+1!==found.size)throw new Error('Missing or inconsistent page range');
      if(total!==null&&total!==Number(match[3]))throw new Error('Result total changed during pagination');
      total=Number(match[3]);
    } else {
      const ids=[...text.matchAll(/Position ID:\s*(\d+)/g)].map(m=>m[1]);
      if(pages.length!==1||!text.includes('List All Jobs')||ids.length!==found.size||new Set(ids).size!==found.size||[...found.keys()].some(u=>!ids.includes(new URL(u).searchParams.get('JOBID'))))throw new Error('Incomplete InterviewExchange listing');
      if((page.links||[]).some(l=>/^(?:Next|\d+|Next [›»])$/.test(l.text?.trim()||'')))throw new Error('Unrecognized InterviewExchange pagination');
      total=ids.length;
    }
    for(const [key,job] of found){if(seen.has(key))throw new Error('Repeated posting across pages');seen.add(key);jobs.push(job);}
    if(i>=options.maxPages)throw new Error('Page limit exceeded');
  }
  if(jobs.length!==total)throw new Error('Search ended before its advertised total; incomplete results were not emitted');
  return {jobs,pages:pages.length,complete:true,reportedTotal:total,source:url,backend:'extension',debugger:false};
}

export async function searchExtensionJobs(options,{env=process.env,execute=execFile}={}) {
  options={maxPages:100,...options};validateExtensionSearch(options);
  const payload=Buffer.from(JSON.stringify(options)).toString('base64');
  const program=`import base64, json\nrequest=json.loads(base64.b64decode('${payload}'))\n`+readFileSync(new URL('./lib/browser-harness/college.py',import.meta.url),'utf8');
  // Same lock as Indeed: both operations share the extension's selected tab.
  const lock=path.join(os.tmpdir(),`career-ops-indeed-${process.getuid?.()??os.userInfo().username}`);
  return withPipelineLock(lock,()=>new Promise((resolve,reject)=>{
    const child=execute(browserHarnessBinary(env),[],{env:{...env,BH_BACKEND:'extension',BU_NAME:env.CAREER_OPS_BROWSER_HARNESS_SESSION||'career-ops',BH_DOMAIN_SKILLS:'0',BH_RECORD:'0'},timeout:Math.min(300000,30000*options.maxPages),maxBuffer:12*1024*1024},(error,stdout)=>{
      try{
        if(error)throw new Error('Browser Harness search failed or timed out');
        const line=String(stdout).split(/\r?\n/).find(l=>l.startsWith('CAREER_OPS_COLLEGE='));
        if(!line)throw new Error('Browser Harness returned no search result');
        const result=JSON.parse(line.slice('CAREER_OPS_COLLEGE='.length));
        if(result.error)throw new Error(result.error);
        resolve(normalizeExtensionPages(result.pages,options));
      }catch(e){reject(e);}
    });
    child.stdin?.on('error',()=>{});child.stdin?.end(program);
  }),{timeoutMs:240000,maxWaitMs:240000});
}
if(isMainModule(import.meta.url)) {
  const args=process.argv.slice(2);validateFlags(args,['--url','--company','--kind','--max-pages','--help','-h'],'node extension-job-search.mjs --url URL --company NAME --kind hca|interviewexchange',{valueFlags:['--url','--company','--kind','--max-pages'],requireOperand:true});
  try{console.log(JSON.stringify(await searchExtensionJobs({url:flagValue(args,'--url'),company:flagValue(args,'--company'),kind:flagValue(args,'--kind'),maxPages:Number(flagValue(args,'--max-pages')||100)})));}catch(e){console.error(e.message);process.exitCode=1;}
}
